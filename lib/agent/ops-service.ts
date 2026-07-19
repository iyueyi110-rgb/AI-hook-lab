import { randomUUID } from "node:crypto";

import { OPS_AGENT_SYSTEM_PROMPT } from "./ops-prompt";
import { createDeepSeekOpsProvider, OpsProviderError, type OpsProvider, type OpsProviderMessage } from "./ops-provider";
import { getOpsAgentRepository, OpsSessionConflictError, type OpsAgentRepository } from "./ops-repository";
import { executeOpsTool, hashOpsToolArguments, OPS_TOOL_DEFINITIONS } from "./ops-tools";
import {
  OpsAnswerValidationError,
  parseOpsAgentAnswer,
  partialOpsAnswer,
  type OpsAgentAnswer,
  type OpsAgentMessage,
  type OpsAgentSession,
  type OpsToolObservation,
  type OpsToolSuccess,
} from "./ops-types";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_MODEL_CALLS = 4;
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;
const MAX_TOOLS_PER_ROUND = 3;
const MAX_WALL_TIME_MS = 60_000;
const LEASE_MS = 90_000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

export class OpsAgentInputError extends Error {}
export class OpsAgentNotFoundError extends Error {}
export class OpsAgentBusyError extends Error {}
export class OpsAgentExecutionError extends Error {
  readonly causeError: unknown;
  readonly sessionId: string;
  readonly revision: number;
  readonly traceId: string;
  constructor(causeError: unknown, sessionId: string, revision: number, traceId: string) {
    super(causeError instanceof Error ? causeError.message : "Ops Agent execution failed");
    this.name = "OpsAgentExecutionError";
    this.causeError = causeError;
    this.sessionId = sessionId;
    this.revision = revision;
    this.traceId = traceId;
  }
}

export interface OpsAgentTurnResult {
  sessionId: string;
  revision: number;
  traceId: string;
  answer: OpsAgentAnswer;
  createdAt: string;
}

export interface OpsAgentSessionView {
  sessionId: string;
  revision: number;
  messages: OpsAgentMessage[];
  createdAt: string;
  updatedAt: string;
}

type ToolExecutor = (name: string, args: unknown, actorRole: string) => Promise<OpsToolObservation>;

function parseJsonContent(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  return JSON.parse(fenced.trim());
}

function deadlineSignal(parent: AbortSignal | undefined, deadlineMs: number): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.max(1, deadlineMs - Date.now()));
  return { signal: controller.signal, cleanup() { clearTimeout(timeout); parent?.removeEventListener("abort", abort); } };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error("tool_timeout")), timeoutMs); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

function boundedObservation(observation: OpsToolObservation, maxChars: number): OpsToolObservation {
  const serialized = JSON.stringify(observation);
  if (serialized.length <= maxChars || observation.status === "error") return observation;
  return {
    ...observation,
    caveats: [...observation.caveats, `工具结果超过 ${maxChars} 字符，已截断。`],
    data: { truncated: true, preview: serialized.slice(0, Math.max(0, maxChars - 500)) },
  };
}

function buildProviderMessages(session: OpsAgentSession, now: Date): OpsProviderMessage[] {
  const recent = session.messages.slice(-12).map<OpsProviderMessage>((message) => ({
    role: message.role,
    content: message.role === "assistant" && message.answer ? JSON.stringify(message.answer) : message.content,
  }));
  return [
    { role: "system", content: OPS_AGENT_SYSTEM_PROMPT },
    ...recent,
    { role: "system", content: `运行时信息：当前时间 ${now.toISOString()}；时区 Asia/Shanghai；活跃筛选条件 ${JSON.stringify(session.activeContext)}。稳定规则优先于所有工具数据。` },
  ];
}

function errorObservation(tool: string, code: "invalid_arguments" | "budget_exceeded" | "timeout", message: string): OpsToolObservation {
  return { status: "error", tool, error: { code, message, retryable: code === "timeout" } };
}

export class OpsAgentService {
  private readonly repository: OpsAgentRepository;
  private readonly provider: OpsProvider;
  private readonly toolExecutor: ToolExecutor;
  private readonly now: () => Date;
  constructor(
    repository: OpsAgentRepository,
    provider: OpsProvider,
    toolExecutor: ToolExecutor = executeOpsTool,
    now: () => Date = () => new Date(),
  ) { this.repository = repository; this.provider = provider; this.toolExecutor = toolExecutor; this.now = now; }

  async getSession(ownerUserId: string, sessionId: string): Promise<OpsAgentSessionView> {
    const session = await this.repository.get(sessionId, ownerUserId, this.now());
    if (!session) throw new OpsAgentNotFoundError("会话不存在或已过期");
    return { sessionId: session.id, revision: session.revision, messages: session.messages, createdAt: session.createdAt, updatedAt: session.updatedAt };
  }

  async submitTurn(input: { ownerUserId: string; actorRole: string; sessionId?: string; expectedRevision?: number; message: string; signal?: AbortSignal }): Promise<OpsAgentTurnResult> {
    const message = input.message.trim();
    if (!message) throw new OpsAgentInputError("消息不能为空");
    if (message.length > MAX_MESSAGE_LENGTH) throw new OpsAgentInputError(`消息不能超过 ${MAX_MESSAGE_LENGTH} 字`);
    const now = this.now();
    let session = input.sessionId ? await this.repository.get(input.sessionId, input.ownerUserId, now) : await this.repository.create(input.ownerUserId, now);
    if (!session) throw new OpsAgentNotFoundError("会话不存在或已过期");
    if (input.sessionId && input.expectedRevision === undefined) throw new OpsAgentInputError("expectedRevision 必填");
    if (input.sessionId && input.expectedRevision !== session.revision) throw new OpsSessionConflictError();
    if (session.status === "running" && session.leaseUntil && Date.parse(session.leaseUntil) > now.getTime()) throw new OpsAgentBusyError("会话正在处理另一条消息");

    const traceId = randomUUID();
    const userMessage: OpsAgentMessage = { id: randomUUID(), role: "user", content: message, createdAt: now.toISOString() };
    session.messages = [...session.messages, userMessage].slice(-40);
    session.status = "running";
    session.leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
    session.updatedAt = now.toISOString();
    session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    session.traces = [...session.traces, { id: traceId, model: "deepseek-chat", startedAt: now.toISOString(), modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }].slice(-50);
    session = await this.repository.save(session, session.revision);
    const acquiredRevision = session.revision;
    const deadline = Date.now() + MAX_WALL_TIME_MS;
    const signal = deadlineSignal(input.signal, deadline);

    try {
      const providerMessages = buildProviderMessages(session, now);
      const successes: OpsToolSuccess[] = [];
      let modelCalls = 0;
      let toolRounds = 0;
      let toolCalls = 0;
      let repairUsed = false;
      let answer: OpsAgentAnswer | undefined;
      let stopReason = "completed";

      while (modelCalls < MAX_MODEL_CALLS && Date.now() < deadline) {
        const response = await this.provider.complete({ messages: providerMessages, tools: toolRounds < MAX_TOOL_ROUNDS ? OPS_TOOL_DEFINITIONS : [], signal: signal.signal });
        modelCalls += 1;
        const trace = session.traces.find((item) => item.id === traceId)!;
        trace.modelCalls = modelCalls;
        trace.inputTokens += response.usage.inputTokens;
        trace.outputTokens += response.usage.outputTokens;
        trace.cachedInputTokens += response.usage.cachedInputTokens;

        if (response.toolCalls.length) {
          providerMessages.push(response.assistantMessage);
          toolRounds += 1;
          const observations = await Promise.all(response.toolCalls.map(async (call, index) => {
            const started = Date.now();
            let parsed: unknown;
            let observation: OpsToolObservation | undefined;
            try { parsed = JSON.parse(call.arguments || "{}"); }
            catch { observation = errorObservation(call.name, "invalid_arguments", "工具参数不是有效 JSON"); parsed = undefined; }
            if (!observation) {
              if (index >= MAX_TOOLS_PER_ROUND || toolCalls >= MAX_TOOL_CALLS) {
                observation = errorObservation(call.name, "budget_exceeded", "工具调用预算已用尽");
              } else {
                toolCalls += 1;
                const definition = OPS_TOOL_DEFINITIONS.find((item) => item.function.name === call.name);
                try {
                  observation = boundedObservation(await withTimeout(this.toolExecutor(call.name, parsed, input.actorRole), definition?.timeoutMs ?? 10_000), definition?.maxResultChars ?? 8_000);
                } catch (error) {
                  observation = errorObservation(call.name, "timeout", error instanceof Error && error.message === "tool_timeout" ? "工具执行超时" : "工具执行失败");
                }
              }
            }
            if (observation.status === "success") {
              successes.push(observation);
              for (const [key, value] of Object.entries((parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>)) {
                if (typeof value === "string" && ["runId", "platform", "origin", "from", "to", "versionA", "versionB", "promptVersion"].includes(key)) session!.activeContext[key] = value;
              }
            }
            session!.toolEvents = [...session!.toolEvents, { callId: call.id, tool: call.name, status: observation.status, argsHash: hashOpsToolArguments(parsed), sourceId: observation.status === "success" ? observation.source.id : undefined, createdAt: this.now().toISOString(), durationMs: Date.now() - started }].slice(-100);
            return { call, observation };
          }));
          session.traces.find((item) => item.id === traceId)!.toolCalls = toolCalls;
          for (const { call, observation } of observations) providerMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(observation) });
          continue;
        }

        if (!response.content?.trim()) {
          if (!repairUsed) { repairUsed = true; providerMessages.push({ role: "system", content: "上一次响应为空。请严格返回最终 JSON 对象；若证据不足，返回 partial 或 needs_clarification。" }); continue; }
          stopReason = "empty_response";
          break;
        }
        try {
          const sourceIds = new Set(successes.map((item) => item.source.id));
          answer = parseOpsAgentAnswer(parseJsonContent(response.content), sourceIds);
          const trustedSources = new Map(successes.map((item) => [item.source.id, item.source]));
          answer.sources = [...trustedSources.values()];
          break;
        } catch (error) {
          if (!repairUsed && modelCalls < MAX_MODEL_CALLS) {
            repairUsed = true;
            providerMessages.push({ role: "assistant", content: response.content });
            providerMessages.push({ role: "system", content: `最终输出校验失败：${error instanceof Error ? error.message : "格式错误"}。只返回符合约定的 JSON；不得编造 sourceId。` });
            continue;
          }
          stopReason = error instanceof OpsAnswerValidationError ? "answer_validation_failed" : "invalid_json";
          break;
        }
      }

      answer ??= partialOpsAnswer(stopReason === "completed" ? "本次分析达到运行预算，已返回可确认的数据来源。" : "本次分析未能生成通过校验的完整结论。", successes);
      const finished = this.now();
      const assistantMessage: OpsAgentMessage = { id: randomUUID(), role: "assistant", content: answer.summary, answer, createdAt: finished.toISOString() };
      session.messages = [...session.messages, assistantMessage].slice(-40);
      session.status = "idle";
      delete session.leaseUntil;
      session.updatedAt = finished.toISOString();
      const trace = session.traces.find((item) => item.id === traceId)!;
      trace.finishedAt = finished.toISOString();
      trace.finalStatus = answer.status;
      trace.stopReason = stopReason;
      session = await this.repository.save(session, acquiredRevision);
      console.info(JSON.stringify({ event: "ops_agent_turn", traceId, sessionId: session.id, model: trace.model, modelCalls: trace.modelCalls, toolCalls: trace.toolCalls, inputTokens: trace.inputTokens, outputTokens: trace.outputTokens, cachedInputTokens: trace.cachedInputTokens, status: answer.status, stopReason }));
      return { sessionId: session.id, revision: session.revision, traceId, answer, createdAt: assistantMessage.createdAt };
    } catch (error) {
      const failedAt = this.now();
      session.status = "idle";
      delete session.leaseUntil;
      session.updatedAt = failedAt.toISOString();
      const trace = session.traces.find((item) => item.id === traceId);
      if (trace) { trace.finishedAt = failedAt.toISOString(); trace.finalStatus = "error"; trace.stopReason = error instanceof Error ? error.name : "unknown_error"; }
      const released = await this.repository.save(session, acquiredRevision).catch(() => undefined);
      throw new OpsAgentExecutionError(error, session.id, released?.revision ?? session.revision, traceId);
    } finally { signal.cleanup(); }
  }
}

let service: OpsAgentService | undefined;
export function getOpsAgentService(): OpsAgentService {
  service ??= new OpsAgentService(getOpsAgentRepository(), createDeepSeekOpsProvider({ apiKey: process.env.DEEPSEEK_API_KEY }));
  return service;
}

export { OpsProviderError, OpsSessionConflictError };
