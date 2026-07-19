import { DatabaseNotConfiguredError } from "../persistence";
import type { EvaluationUser } from "../evaluation/types";
import { OpsProviderError } from "./ops-provider";
import { OpsSessionConflictError } from "./ops-repository";
import { getOpsAgentService, OpsAgentBusyError, OpsAgentExecutionError, OpsAgentInputError, OpsAgentNotFoundError, type OpsAgentService } from "./ops-service";

export const MAX_OPS_AGENT_JSON_BYTES = 16 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface Options {
  service?: OpsAgentService;
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  currentUser?: () => Promise<EvaluationUser | null>;
}

export function isOpsAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPS_AGENT_ENABLED !== undefined) return env.OPS_AGENT_ENABLED === "true";
  return env.NODE_ENV !== "production";
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "Cross-origin request denied");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const rawLength = request.headers.get("content-length");
  if (rawLength && Number(rawLength) > MAX_OPS_AGENT_JSON_BYTES) throw new HttpError(413, "请求体过大");
  if (!request.body) throw new HttpError(400, "请求体必须是 JSON 对象");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OPS_AGENT_JSON_BYTES) { await reader.cancel("request_too_large"); throw new HttpError(413, "请求体过大"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, "请求体必须是 JSON 对象"); }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new HttpError(400, "请求包含不支持的字段");
}

function errorResponse(error: unknown): Response {
  const execution = error instanceof OpsAgentExecutionError ? error : undefined;
  const cause = execution?.causeError ?? error;
  const context = execution ? { sessionId: execution.sessionId, revision: execution.revision, traceId: execution.traceId } : {};
  if (cause instanceof HttpError) return json({ error: "request_error", message: cause.message, retryable: false, ...context }, cause.status);
  if (cause instanceof OpsAgentInputError) return json({ error: "validation", message: cause.message, retryable: false, ...context }, 400);
  if (cause instanceof OpsAgentNotFoundError) return json({ error: "not_found", message: cause.message, retryable: false, ...context }, 404);
  if (cause instanceof OpsAgentBusyError || cause instanceof OpsSessionConflictError) return json({ error: "conflict", message: cause.message, retryable: true, ...context }, 409);
  if (cause instanceof OpsProviderError) {
    const status = cause.code === "missing_key" ? 503 : cause.code === "rate_limit" ? 429 : cause.code === "timeout" ? 504 : 502;
    const message = cause.code === "missing_key" ? "DEEPSEEK_API_KEY 未配置" : cause.code === "rate_limit" ? "AI 服务请求过于频繁" : cause.code === "timeout" ? "AI 服务响应超时" : "AI 服务暂时不可用";
    return json({ error: cause.code, message, retryable: cause.code !== "missing_key" && cause.code !== "auth", ...context }, status, cause.code === "rate_limit" ? { "Retry-After": "30" } : undefined);
  }
  if (cause instanceof DatabaseNotConfiguredError || (cause instanceof Error && cause.message.includes("生产环境数据库未配置"))) return json({ error: "database_unavailable", message: "生产环境数据库未配置", retryable: false, ...context }, 503);
  return json({ error: "internal_error", message: "运营分析 Agent 暂时无法处理请求", retryable: true, ...context }, 500);
}

export function createOpsAgentHttpHandlers(options: Options = {}) {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? isOpsAgentEnabled(env);
  const currentUser = options.currentUser ?? (async () => (await import("../evaluation/server")).getCurrentEvaluationUser());
  let service = options.service;
  const getService = () => service ??= getOpsAgentService();
  const authorize = async () => {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "Unauthorized");
    if (user.role !== "admin") throw new HttpError(403, "Forbidden");
    return user;
  };
  return {
    async get(request: Request): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "Not found", retryable: false }, 404);
        const user = await authorize();
        const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
        if (!sessionId || sessionId.length > 100) throw new HttpError(400, "sessionId 无效");
        return json(await getService().getSession(user.id, sessionId));
      } catch (error) { return errorResponse(error); }
    },
    async post(request: Request): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "Not found", retryable: false }, 404);
        assertSameOrigin(request);
        const user = await authorize();
        const body = await readJson(request);
        exactKeys(body, ["sessionId", "expectedRevision", "message"]);
        if (typeof body.message !== "string") throw new HttpError(400, "message 必填");
        if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 100)) throw new HttpError(400, "sessionId 无效");
        if (body.expectedRevision !== undefined && (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)) throw new HttpError(400, "expectedRevision 无效");
        return json(await getService().submitTurn({
          ownerUserId: user.id,
          actorRole: user.role,
          sessionId: body.sessionId as string | undefined,
          expectedRevision: body.expectedRevision as number | undefined,
          message: body.message,
          signal: request.signal,
        }));
      } catch (error) { return errorResponse(error); }
    },
  };
}

export const opsAgentHttpHandlers = createOpsAgentHttpHandlers();
