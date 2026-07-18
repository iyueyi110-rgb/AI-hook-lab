import { createHash } from "node:crypto";

import { GenerationError } from "../generation/service.ts";
import { validateImageUpload } from "../imageAnalysis.ts";
import {
  MAX_IMAGE_DESCRIPTION_LENGTH,
  MAX_TARGET_AUDIENCE_LENGTH,
  MAX_TOPIC_LENGTH,
  findSensitiveInputHints,
} from "../promptTemplates.ts";
import type { GenerateResponse, HookResult, ImageAnalysisResult } from "../types.ts";
import { normalizeBrief } from "./brief.ts";
import { compareCandidates } from "./candidates.ts";
import { AgentConflictError, assertExpectedRevision, getAllowedCommands, transition } from "./machine.ts";
import { assertToolAllowed } from "./tools.ts";
import {
  AgentNotFoundError,
  type AgentRepository,
  type CreatorSession,
  type StoredAgentRun,
  createCreatorSession,
  deleteCreatorMemory,
  findOwnedRun,
  listCreatorMemory,
  recordCreatorMemory,
  resolveCreatorSession,
} from "./repository.ts";
import type { AgentCommand, Candidate, CreativeBrief, MemoryKey, Message, ToolName } from "./types.ts";

export const MAX_AGENT_MESSAGE_LENGTH = 2_000;
export const DEFAULT_AGENT_OPERATION_LEASE_MS = 120_000;

export interface CoachGenerationRequest {
  kind: "initial" | "rewrite" | "regenerate";
  count: 3 | 10;
  brief: CreativeBrief;
  sourceCandidate?: Candidate;
  instruction?: string;
  reason?: string;
}

export type CoachRunState = Omit<StoredAgentRun, "creatorSessionId">;

export interface CoachRunResponse {
  run: CoachRunState;
  messages: Message[];
  candidates: Candidate[];
  topCandidates: Candidate[];
  comparisonExplanations: string[];
  pendingConfirmation: "brief" | "final" | null;
  allowedCommands: AgentCommand["type"][];
  needsInput: boolean;
  finalizedResponse?: GenerateResponse;
}

export interface CoachMemoryEntry {
  id: string;
  key: MemoryKey;
  value: string;
  confidence: number;
}

export class AgentInputError extends Error {
  readonly code = "agent_input_invalid" as const;
  constructor(message: string) { super(message); this.name = "AgentInputError"; }
}

export class AgentProviderError extends Error {
  readonly code = "agent_provider_error" as const;
  readonly status: number;
  readonly response: CoachRunResponse;
  readonly causeCode: string;
  constructor(status: number, causeCode: string, response: CoachRunResponse) {
    super(`Agent provider failed: ${causeCode}`);
    this.name = "AgentProviderError";
    this.status = status;
    this.causeCode = causeCode;
    this.response = response;
  }
}

export interface CreativeCoachDependencies {
  repository: AgentRepository;
  generate: (request: CoachGenerationRequest) => Promise<GenerateResponse>;
  analyzeImage: (file: File) => Promise<ImageAnalysisResult>;
  decideBriefPatch?: (request: {
    message: string;
    missingField: "topic" | "platform" | "contentType";
    currentBrief: Partial<CreativeBrief>;
  }) => Promise<Record<string, unknown>>;
  now?: () => Date;
  id?: (prefix: string) => string;
  operationLeaseMs?: number;
}

function defaultId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function wordLimitFor(band: CreativeBrief["wordLimitBand"]): number {
  return Number(band.split("-")[1]) || 80;
}

function toCandidate(hook: HookResult, index: number): Candidate {
  const fallback = Math.max(1, Math.min(10, Math.round(hook.overallScore ?? hook.score ?? 7)));
  const scores = hook.scores ?? { impact: fallback, platformFit: fallback, actionability: fallback, shareability: fallback };
  return {
    id: hook.id || `candidate-${index}`,
    text: String(hook.text ?? "").trim(),
    style: String(hook.style ?? "").trim(),
    reasoning: String(hook.reasoning ?? "").trim(),
    overallScore: Math.max(1, Math.min(10, Math.round(hook.overallScore ?? hook.score ?? fallback))),
    scores,
    badcaseTags: Array.isArray(hook.badcaseTags) ? [...new Set(hook.badcaseTags)] : [],
  };
}

function syncRunSummary(run: StoredAgentRun): void {
  run.summary = {
    messageCount: Math.max(run.summary?.messageCount ?? 0, run.messages.length),
    latestMessageAt: run.messages.at(-1)?.createdAt ?? run.summary?.latestMessageAt,
    candidateCount: run.candidates.length,
    status: run.status,
  };
}

const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function finalizedResponseForRun(run: StoredAgentRun): GenerateResponse | undefined {
  if (run.status !== "completed" || !run.brief || !run.selectedCandidateId) return undefined;
  const selected = run.candidates.find((candidate) => candidate.id === run.selectedCandidateId);
  if (!selected) return undefined;
  const generatedAt = run.finalizedAt ?? run.updatedAt;
  if (!isCanonicalIsoTimestamp(generatedAt)) return undefined;
  return {
    taskId: run.id,
    hooks: [{ ...selected, clickScore: selected.overallScore * 10 }],
    generatedAt,
    topic: run.brief.topic,
    platform: run.brief.platform,
    contentType: run.brief.contentType,
    targetAudience: run.brief.targetAudience,
    emotionTone: run.brief.emotionTone,
    wordLimit: wordLimitFor(run.brief.wordLimitBand),
    model: "creative-coach",
  };
}

function asResponse(run: StoredAgentRun, messages: Message[] = [], finalizedResponse?: GenerateResponse): CoachRunResponse {
  syncRunSummary(run);
  const comparison = compareCandidates(run.candidates);
  const publicRun = structuredClone(run) as CoachRunState & { creatorSessionId?: string };
  delete publicRun.creatorSessionId;
  return {
    run: publicRun,
    messages: structuredClone(messages),
    candidates: structuredClone(run.candidates),
    topCandidates: structuredClone(comparison.top3),
    comparisonExplanations: comparison.explanations,
    pendingConfirmation: run.status === "awaiting_brief_confirmation" ? "brief" : run.status === "awaiting_final_confirmation" ? "final" : null,
    allowedCommands: run.activeOperation
      ? []
      : run.status === "failed" && run.recoverable && run.resumeStatus
        ? ["retry"]
        : getAllowedCommands(run.status),
    needsInput: !run.activeOperation && (
      run.status === "understanding" || run.status === "analyzing_image" || run.status === "awaiting_brief_confirmation"
      || run.status === "reviewing" || run.status === "awaiting_final_confirmation"
      || (run.status === "failed" && Boolean(run.recoverable && run.resumeStatus))
    ),
    ...((finalizedResponse ?? finalizedResponseForRun(run)) ? { finalizedResponse: finalizedResponse ?? finalizedResponseForRun(run) } : {}),
  };
}

function providerStatus(error: unknown): { status: number; code: string } {
  if (error instanceof GenerationError) {
    if (error.code === "rate_limit") return { status: 429, code: error.code };
    if (error.code === "timeout") return { status: 504, code: error.code };
    if (error.code === "auth" || error.code === "upstream") return { status: 502, code: error.code };
    if (error.code === "missing_key") return { status: 503, code: error.code };
    return { status: 502, code: error.code };
  }
  return { status: 502, code: "provider_error" };
}

function memoryId(key: MemoryKey, value: string): string {
  return createHash("sha256").update(`${key}\0${value}`).digest("base64url").slice(0, 22);
}

function applyMemoryToBrief(input: Record<string, unknown>, entries: Array<{ key: MemoryKey; value: string }>): Record<string, unknown> {
  const result = { ...input };
  for (const entry of entries) {
    if (entry.key === "default_platform" && result.platform === undefined) result.platform = entry.value;
    if (entry.key === "preferred_tone" && result.emotionTone === undefined) result.emotionTone = entry.value;
    if (entry.key === "word_limit_band" && result.wordLimitBand === undefined) result.wordLimitBand = entry.value;
    if (entry.key === "preferred_style" && result.preferredStyle === undefined) result.preferredStyle = entry.value;
    if (entry.key === "avoid_badcase_tag" && !("avoidBadcaseTags" in input)) {
      const current = Array.isArray(result.avoidBadcaseTags) ? result.avoidBadcaseTags.filter((item): item is string => typeof item === "string") : [];
      result.avoidBadcaseTags = [...new Set([...current, entry.value])];
    }
  }
  return result;
}

function assertActiveOperation(run: StoredAgentRun, operationId: string, kind: NonNullable<StoredAgentRun["activeOperation"]>["kind"]): void {
  if (!run.activeOperation || run.activeOperation.id !== operationId || run.activeOperation.kind !== kind) {
    throw new AgentConflictError("Agent operation is no longer current");
  }
}

function questionFor(field: "topic" | "platform" | "contentType"): string {
  return `Please provide the missing ${field}.`;
}

function parseClarificationValue(field: "topic" | "platform" | "contentType", text: string): Record<string, string> {
  const value = text.trim();
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch { /* Treat malformed JSON as the answer to the current field. */ }
  }
  return { [field]: value };
}

function applyClarification(
  run: StoredAgentRun,
  text: string,
  patch: Record<string, unknown>,
  timestamp: string,
  makeId: (prefix: string) => string,
): Message[] {
  const source = { ...(run.brief ?? run.briefDraft ?? {}), ...patch };
  run.briefDraft = source;
  const normalized = normalizeBrief(source, run.clarificationAttempts ?? 0);
  const addedMessages: Message[] = [{ id: makeId("message"), role: "user", content: text, createdAt: timestamp }];
  if (normalized.kind === "complete") {
    run.brief = normalized.brief;
    run.briefDraft = normalized.brief;
    run.status = "awaiting_brief_confirmation";
    run.requiresFormCompletion = undefined;
  } else if ((run.clarificationAttempts ?? 0) < 2) {
    run.clarificationAttempts = (run.clarificationAttempts ?? 0) + 1;
    addedMessages.push({ id: makeId("message"), role: "assistant", content: questionFor(normalized.missing[0] ?? "topic"), createdAt: timestamp });
  } else {
    run.requiresFormCompletion = true;
    addedMessages.push({ id: makeId("message"), role: "assistant", content: "Please complete the structured brief form.", createdAt: timestamp });
  }
  run.messages.push(...addedMessages);
  run.updatedAt = timestamp;
  return addedMessages;
}

function assertSafeText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return;
  if (typeof value !== "string") throw new AgentInputError(`${field} must be a string`);
  if (value.length > maxLength) throw new AgentInputError(`${field} is too long`);
  if (findSensitiveInputHints(value).length) throw new AgentInputError(`${field} contains possible personal information`);
}

function assertSafeBriefInput(input: Record<string, unknown>): void {
  const allowed = new Set(["topic", "platform", "contentType", "targetAudience", "emotionTone", "wordLimitBand", "preferredStyle", "avoidBadcaseTags", "imageDescription"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new AgentInputError("Brief contains unknown fields");
  assertSafeText(input.topic, "topic", MAX_TOPIC_LENGTH);
  assertSafeText(input.targetAudience, "targetAudience", MAX_TARGET_AUDIENCE_LENGTH);
  assertSafeText(input.imageDescription, "imageDescription", MAX_IMAGE_DESCRIPTION_LENGTH);
  for (const key of ["platform", "contentType", "emotionTone", "wordLimitBand"] as const) assertSafeText(input[key], key, 40);
  assertSafeText(input.preferredStyle, "preferredStyle", 100);
  if (input.avoidBadcaseTags !== undefined) {
    if (!Array.isArray(input.avoidBadcaseTags) || input.avoidBadcaseTags.length > 20) throw new AgentInputError("avoidBadcaseTags is invalid");
    for (const tag of input.avoidBadcaseTags) assertSafeText(tag, "avoidBadcaseTag", 64);
  }
}

export function createCreativeCoachService(dependencies: CreativeCoachDependencies) {
  const { repository } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const id = dependencies.id ?? defaultId;
  const operationLeaseMs = Number.isFinite(dependencies.operationLeaseMs) && dependencies.operationLeaseMs! > 0
    ? dependencies.operationLeaseMs!
    : DEFAULT_AGENT_OPERATION_LEASE_MS;

  function activeOperation(kind: NonNullable<StoredAgentRun["activeOperation"]>["kind"], timestamp: string): NonNullable<StoredAgentRun["activeOperation"]> {
    return {
      id: id("operation"),
      kind,
      startedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + operationLeaseMs).toISOString(),
    };
  }

  function operationExpired(run: StoredAgentRun, current: Date): boolean {
    if (!run.activeOperation) return false;
    const explicitExpiry = Date.parse(run.activeOperation.expiresAt ?? "");
    if (Number.isFinite(explicitExpiry)) return explicitExpiry <= current.getTime();
    const startedAt = Date.parse(run.activeOperation.startedAt);
    return !Number.isFinite(startedAt) || startedAt + operationLeaseMs <= current.getTime();
  }

  function recoverExpiredOperation(run: StoredAgentRun, current: Date): boolean {
    const operation = run.activeOperation;
    if (!operation || !operationExpired(run, current)) return false;
    if (operation.kind === "decision") {
      run.status = "understanding";
      run.recoverable = undefined;
      run.resumeStatus = undefined;
    } else {
      const resumeStatus = operation.kind === "image"
        ? "analyzing_image" as const
        : run.status === "generating" ? "generating" as const : "revising" as const;
      const expectedTool = operation.kind === "image" ? "analyze_image" : undefined;
      const call = [...run.toolCalls].reverse().find((item) => item.status === "requested" && (!expectedTool || item.tool === expectedTool));
      if (call) call.status = "completed";
      run.toolResults.push({
        callId: call?.id,
        tool: call?.tool ?? (operation.kind === "image" ? "analyze_image" : "generate_hooks"),
        status: "error",
        error: { code: "operation_expired", message: "Agent operation lease expired" },
      });
      run.status = "failed";
      run.recoverable = true;
      run.resumeStatus = resumeStatus;
    }
    run.activeOperation = undefined;
    run.updatedAt = current.toISOString();
    run.revision += 1;
    syncRunSummary(run);
    return true;
  }

  async function sessionFromToken(token: string | undefined, create: boolean): Promise<{ session: CreatorSession; token?: string }> {
    return repository.transaction((state) => {
      const existing = resolveCreatorSession(state, token, now());
      if (existing) return { session: existing };
      if (!create) throw new AgentNotFoundError();
      const created = createCreatorSession(state, now());
      return { session: created.session, token: created.token };
    });
  }

  async function recoverOwnedRun(ownerId: string, runId: string): Promise<StoredAgentRun> {
    return repository.transaction((state) => {
      const run = findOwnedRun(state, runId, ownerId);
      recoverExpiredOperation(run, now());
      return structuredClone(run);
    });
  }

  async function completeGeneration(ownerId: string, runId: string, request: CoachGenerationRequest, revision: number, operationId: string): Promise<CoachRunResponse> {
    let candidates: Candidate[];
    try {
      const generated = await dependencies.generate(request);
      if (generated.hooks.length !== request.count) throw new GenerationError("invalid_count");
      candidates = generated.hooks.map(toCandidate);
      if (candidates.some((candidate) => !candidate.text)) throw new GenerationError("invalid_json");
      if (candidates.some((candidate) => findSensitiveInputHints(`${candidate.text}\n${candidate.reasoning}`).length)) {
        throw new GenerationError("internal");
      }
    } catch (error) {
      const mapped = providerStatus(error);
      await recoverOwnedRun(ownerId, runId);
      const response = await repository.transaction((state) => {
        const run = findOwnedRun(state, runId, ownerId);
        assertExpectedRevision(run, revision);
        assertActiveOperation(run, operationId, "generation");
        const resumeStatus = run.status === "generating" ? "generating" : "revising";
        run.status = "failed";
        run.activeOperation = undefined;
        run.recoverable = true;
        run.resumeStatus = resumeStatus;
        const call = [...run.toolCalls].reverse().find((item) => item.status === "requested");
        if (call) call.status = "completed";
        run.toolResults.push({ callId: call?.id, tool: call?.tool ?? "generate_hooks", status: "error", error: { code: mapped.code, message: "Provider request failed" } });
        run.updatedAt = now().toISOString();
        run.revision += 1;
        return asResponse(run);
      });
      throw new AgentProviderError(mapped.status, mapped.code, response);
    }
    await recoverOwnedRun(ownerId, runId);
    return repository.transaction((state) => {
      const run = findOwnedRun(state, runId, ownerId);
      assertExpectedRevision(run, revision);
      assertActiveOperation(run, operationId, "generation");
      run.candidates = candidates;
      run.status = "reviewing";
      run.recoverable = undefined;
      run.resumeStatus = undefined;
      run.pendingGeneration = undefined;
      run.activeOperation = undefined;
      const call = [...run.toolCalls].reverse().find((item) => item.status === "requested");
      if (call) call.status = "completed";
      run.toolResults.push({ callId: call?.id, tool: request.kind === "initial" ? "generate_hooks" : request.kind === "rewrite" ? "rewrite_hook" : "regenerate_batch", status: "success", output: { count: candidates.length } });
      const compareId = id("tool");
      run.toolCalls.push({ id: compareId, tool: "compare_candidates", input: { candidateCount: candidates.length }, status: "completed", createdAt: now().toISOString() });
      run.toolResults.push({ callId: compareId, tool: "compare_candidates", status: "success", output: { topCandidateIds: compareCandidates(candidates).top3.map((item) => item.id) } });
      run.updatedAt = now().toISOString();
      run.revision += 1;
      return asResponse(run);
    });
  }

  return {
    async createRun(sessionToken: string | undefined, input: { brief?: Record<string, unknown>; hasImage?: boolean; ignoreMemory?: boolean }): Promise<{ sessionToken: string; response: CoachRunResponse }> {
      assertSafeBriefInput(input.brief ?? {});
      const owner = await sessionFromToken(sessionToken, true);
      const response = await repository.transaction((state) => {
        const memory = input.ignoreMemory ? { entries: [] } : listCreatorMemory(state, owner.session.id, now());
        const source = applyMemoryToBrief(input.brief ?? {}, memory.entries);
        const normalized = normalizeBrief(source, 0);
        const createdAt = now().toISOString();
        const messages: Message[] = [];
        let status: StoredAgentRun["status"];
        let clarificationAttempts = 0;
        let brief: CreativeBrief | undefined;
        if (input.hasImage) {
          status = "analyzing_image";
          if (normalized.kind === "complete") brief = normalized.brief;
        } else if (normalized.kind === "complete") {
          status = "awaiting_brief_confirmation";
          brief = normalized.brief;
        } else {
          status = "understanding";
          clarificationAttempts = 1;
          messages.push({ id: id("message"), role: "assistant", content: questionFor(normalized.missing[0] ?? "topic"), createdAt });
        }
        const run: StoredAgentRun = {
          id: id("run"), creatorSessionId: owner.session.id, revision: 0, status, brief,
          briefDraft: brief ?? source as Partial<CreativeBrief>,
          messages, candidates: [], toolCalls: [], toolResults: [], approvals: [], memory,
          revisionRounds: 0, clarificationAttempts, createdAt, updatedAt: createdAt,
          summary: { messageCount: messages.length, latestMessageAt: messages.at(-1)?.createdAt, candidateCount: 0, status },
        };
        state.runs.push(run);
        return asResponse(run, messages);
      });
      return { sessionToken: owner.token ?? sessionToken!, response };
    },

    async getRun(sessionToken: string | undefined, runId: string): Promise<CoachRunResponse> {
      const owner = await sessionFromToken(sessionToken, false);
      return asResponse(await recoverOwnedRun(owner.session.id, runId));
    },

    async cancelRun(sessionToken: string | undefined, runId: string, expectedRevision: number): Promise<CoachRunResponse> {
      const owner = await sessionFromToken(sessionToken, false);
      await recoverOwnedRun(owner.session.id, runId);
      return repository.transaction((state) => {
        const run = findOwnedRun(state, runId, owner.session.id);
        assertExpectedRevision(run, expectedRevision);
        if (["completed", "cancelled"].includes(run.status)) throw new AgentConflictError("Terminal run cannot be cancelled");
        if (run.activeOperation) {
          const call = [...run.toolCalls].reverse().find((item) => item.status === "requested");
          if (call) {
            call.status = "completed";
            run.toolResults.push({ callId: call.id, tool: call.tool, status: "error", error: { code: "cancelled", message: "Operation cancelled by user" } });
          }
          run.activeOperation = undefined;
        }
        run.status = "cancelled";
        run.revision += 1;
        run.updatedAt = now().toISOString();
        return asResponse(run);
      });
    },

    async submitTurn(sessionToken: string | undefined, runId: string, expectedRevision: number, command: AgentCommand): Promise<CoachRunResponse> {
      if (command.type === "message" && command.text.length > MAX_AGENT_MESSAGE_LENGTH) throw new AgentInputError("Message is too long");
      if (command.type === "message") assertSafeText(command.text, "message", MAX_AGENT_MESSAGE_LENGTH);
      if (command.type === "rewrite_candidate") assertSafeText(command.instruction, "instruction", 1_000);
      if (command.type === "reject_batch") assertSafeText(command.reason, "reason", 1_000);
      if (command.type === "confirm_brief") assertSafeBriefInput(command.briefPatch ?? {});
      const owner = await sessionFromToken(sessionToken, false);
      await recoverOwnedRun(owner.session.id, runId);
      const prepared = await repository.transaction((state) => {
        const run = findOwnedRun(state, runId, owner.session.id);
        assertExpectedRevision(run, expectedRevision);
        const timestamp = now().toISOString();
        const addedMessages: Message[] = [];
        if (run.activeOperation) throw new AgentConflictError("An agent operation is already in flight");

        if (run.status === "understanding" && command.type === "message") {
          const currentBrief = run.brief ?? run.briefDraft ?? {};
          const current = normalizeBrief(currentBrief, run.clarificationAttempts ?? 0);
          const missingField = current.kind === "complete" ? undefined : current.missing[0];
          const directPatch = missingField ? parseClarificationValue(missingField, command.text) : {};
          assertSafeBriefInput(directPatch);
          const direct = normalizeBrief({ ...currentBrief, ...directPatch }, run.clarificationAttempts ?? 0);
          const directMissing = direct.kind === "complete" ? undefined : direct.missing[0];
          if (missingField && dependencies.decideBriefPatch && direct.kind !== "complete" && directMissing === missingField) {
            const operation = activeOperation("decision", timestamp);
            const operationId = operation.id;
            run.activeOperation = operation;
            run.revision += 1;
            run.updatedAt = timestamp;
            asResponse(run);
            return {
              kind: "decision" as const,
              operationId,
              revision: run.revision,
              directPatch,
              request: { message: command.text, missingField, currentBrief },
            };
          }
          addedMessages.push(...applyClarification(run, command.text, directPatch, timestamp, id));
          run.revision += 1;
          return { kind: "response" as const, response: asResponse(run, addedMessages) };
        }

        if (command.type === "retry") {
          if (run.status !== "failed" || !run.recoverable || !run.resumeStatus) throw new AgentConflictError("Run cannot retry");
          const resume = transition(run.status, command, { recoverable: run.recoverable, resumeStatus: run.resumeStatus });
          run.status = resume;
          run.revision += 1;
          run.recoverable = undefined;
          run.resumeStatus = undefined;
          run.updatedAt = timestamp;
          if (resume === "analyzing_image") return { kind: "response" as const, response: asResponse(run) };
          if (!run.pendingGeneration || !run.brief) throw new AgentConflictError("Retry context is missing");
          const pending = run.pendingGeneration;
          const sourceCandidate = pending.sourceCandidateId ? run.candidates.find((item) => item.id === pending.sourceCandidateId) : undefined;
          const operation = activeOperation("generation", timestamp);
          const operationId = operation.id;
          run.activeOperation = operation;
          const tool: ToolName = pending.kind === "initial" ? "generate_hooks" : pending.kind === "rewrite" ? "rewrite_hook" : "regenerate_batch";
          run.toolCalls.push({ id: id("tool"), tool, input: { expectedCount: pending.count, retry: true }, status: "requested", createdAt: timestamp });
          asResponse(run);
          return { kind: "generate" as const, operationId, request: { ...pending, brief: run.brief, sourceCandidate } satisfies CoachGenerationRequest, revision: run.revision };
        }

        if (command.type === "confirm_brief") {
          if (!run.brief) throw new AgentConflictError("Brief is incomplete");
          if (command.briefPatch) {
            const normalized = normalizeBrief({ ...run.brief, ...command.briefPatch }, run.clarificationAttempts ?? 0);
            if (normalized.kind !== "complete") throw new AgentInputError("Brief correction is incomplete or invalid");
            run.brief = normalized.brief;
            run.briefDraft = normalized.brief;
          }
          run.status = transition(run.status, command);
          run.revision += 1;
          run.pendingGeneration = { kind: "initial", count: 10 };
          const operation = activeOperation("generation", timestamp);
          const operationId = operation.id;
          run.activeOperation = operation;
          run.toolCalls.push({ id: id("tool"), tool: "generate_hooks", input: { expectedCount: 10 }, status: "requested", createdAt: timestamp });
          run.updatedAt = timestamp;
          asResponse(run);
          return { kind: "generate" as const, operationId, request: { kind: "initial", count: 10, brief: run.brief } satisfies CoachGenerationRequest, revision: run.revision };
        }

        if (command.type === "rewrite_candidate" || command.type === "reject_batch") {
          const nextStatus = transition(run.status, command, { revisionRounds: run.revisionRounds });
          if (!run.brief) throw new AgentConflictError("Brief is incomplete");
          const sourceCandidate = command.type === "rewrite_candidate" ? run.candidates.find((item) => item.id === command.candidateId) : undefined;
          if (command.type === "rewrite_candidate" && !sourceCandidate) throw new AgentConflictError("Candidate was not found");
          run.status = nextStatus;
          run.revision += 1;
          run.revisionRounds += 1;
          const pending = command.type === "rewrite_candidate"
            ? { kind: "rewrite" as const, count: 3 as const, sourceCandidateId: sourceCandidate!.id, instruction: command.instruction }
            : { kind: "regenerate" as const, count: 10 as const, reason: command.reason };
          run.pendingGeneration = pending;
          const operation = activeOperation("generation", timestamp);
          const operationId = operation.id;
          run.activeOperation = operation;
          const tool: ToolName = command.type === "rewrite_candidate" ? "rewrite_hook" : "regenerate_batch";
          run.toolCalls.push({ id: id("tool"), tool, input: { expectedCount: pending.count, ...(command.type === "rewrite_candidate" ? { candidateId: sourceCandidate!.id } : { hasReason: Boolean(command.reason) }) }, status: "requested", createdAt: timestamp });
          run.updatedAt = timestamp;
          asResponse(run);
          return { kind: "generate" as const, operationId, request: { ...pending, brief: run.brief, sourceCandidate } satisfies CoachGenerationRequest, revision: run.revision };
        }

        if (command.type === "select_candidate") {
          const selected = run.candidates.find((item) => item.id === command.candidateId);
          if (!selected) throw new AgentConflictError("Candidate was not found");
          run.status = transition(run.status, command);
          run.selectedCandidateId = selected.id;
          run.revision += 1;
          run.updatedAt = timestamp;
          return { kind: "response" as const, response: asResponse(run) };
        }

        if (command.type === "confirm_final") {
          const selected = run.candidates.find((item) => item.id === run.selectedCandidateId);
          if (!selected || !run.brief) throw new AgentConflictError("A candidate must be selected first");
          assertToolAllowed(run.status, "save_final_choice");
          const callId = id("tool");
          const approvalId = id("approval");
          run.approvals.push({ id: approvalId, tool: "save_final_choice", status: "approved", requestedAt: timestamp, resolvedAt: timestamp });
          run.toolCalls.push({ id: callId, tool: "save_final_choice", input: { candidateId: selected.id }, status: "completed", createdAt: timestamp });
          run.toolResults.push({ callId, tool: "save_final_choice", status: "success", output: { candidateId: selected.id } });
          for (const update of [
            { key: "default_platform" as const, value: run.brief.platform },
            { key: "preferred_tone" as const, value: run.brief.emotionTone },
            { key: "word_limit_band" as const, value: run.brief.wordLimitBand },
            ...(run.brief.preferredStyle ? [{ key: "preferred_style" as const, value: run.brief.preferredStyle }] : []),
            ...run.brief.avoidBadcaseTags.map((value) => ({ key: "avoid_badcase_tag" as const, value })),
          ]) recordCreatorMemory(state, owner.session.id, update, now());
          run.status = transition(run.status, command);
          run.revision += 1;
          run.finalizedAt = timestamp;
          run.updatedAt = timestamp;
          return { kind: "response" as const, response: asResponse(run) };
        }

        if (command.type === "message") {
          if (!getAllowedCommands(run.status).includes("message")) throw new AgentConflictError(`Command message is not allowed while ${run.status}`);
          const message = { id: id("message"), role: "user" as const, content: command.text, createdAt: timestamp };
          run.messages.push(message);
          if (run.status === "awaiting_final_confirmation") {
            run.status = "reviewing";
            run.selectedCandidateId = undefined;
          } else if (run.status === "awaiting_brief_confirmation" && command.text.trim().startsWith("{")) {
            let patch: unknown;
            try { patch = JSON.parse(command.text); } catch { throw new AgentInputError("Brief correction must be valid JSON"); }
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new AgentInputError("Brief correction must be an object");
            assertSafeBriefInput(patch as Record<string, unknown>);
            const normalized = normalizeBrief({ ...(run.brief ?? {}), ...(patch as Record<string, unknown>) }, run.clarificationAttempts ?? 0);
            if (normalized.kind !== "complete") throw new AgentInputError("Brief correction is incomplete or invalid");
            run.brief = normalized.brief;
            run.briefDraft = normalized.brief;
          }
          run.revision += 1;
          run.updatedAt = timestamp;
          return { kind: "response" as const, response: asResponse(run, [message]) };
        }

        throw new AgentConflictError(`Command is not allowed while ${run.status}`);
      });
      if (prepared.kind === "response") return prepared.response;
      if (prepared.kind === "decision") {
        let patch: Record<string, unknown> = prepared.directPatch;
        try {
          const proposed = await dependencies.decideBriefPatch!(prepared.request);
          assertSafeBriefInput(proposed);
          patch = proposed;
        } catch {
          // Fall back to the deterministic answer path; the operation is still
          // completed through the same CAS and no hidden reasoning is persisted.
        }
        await recoverOwnedRun(owner.session.id, runId);
        return repository.transaction((state) => {
          const run = findOwnedRun(state, runId, owner.session.id);
          assertExpectedRevision(run, prepared.revision);
          assertActiveOperation(run, prepared.operationId, "decision");
          const messages = applyClarification(run, command.type === "message" ? command.text : "", patch, now().toISOString(), id);
          run.activeOperation = undefined;
          run.revision += 1;
          return asResponse(run, messages);
        });
      }
      return completeGeneration(owner.session.id, runId, prepared.request, prepared.revision, prepared.operationId);
    },

    async uploadImage(sessionToken: string | undefined, runId: string, expectedRevision: number, file: File): Promise<CoachRunResponse> {
      const owner = await sessionFromToken(sessionToken, false);
      await recoverOwnedRun(owner.session.id, runId);
      const preview = findOwnedRun(await repository.read(), runId, owner.session.id);
      assertExpectedRevision(preview, expectedRevision);
      if (preview.status !== "analyzing_image" || preview.activeOperation) throw new AgentConflictError("Image is not expected in this state");
      const validation = await validateImageUpload(file);
      if (!validation.ok) throw new AgentInputError(validation.message);
      const reserved = await repository.transaction((state) => {
        const run = findOwnedRun(state, runId, owner.session.id);
        assertExpectedRevision(run, expectedRevision);
        if (run.status !== "analyzing_image") throw new AgentConflictError("Image is not expected in this state");
        if (run.activeOperation) throw new AgentConflictError("An image operation is already in flight");
        run.revision += 1;
        const callId = id("tool");
        const operation = activeOperation("image", now().toISOString());
        const operationId = operation.id;
        run.activeOperation = operation;
        run.toolCalls.push({ id: callId, tool: "analyze_image", input: { mimeType: file.type, size: file.size }, status: "requested", createdAt: now().toISOString() });
        run.updatedAt = now().toISOString();
        asResponse(run);
        return { revision: run.revision, callId, operationId, existingBrief: run.brief };
      });
      let analysis: ImageAnalysisResult;
      try {
        analysis = await dependencies.analyzeImage(file);
        assertSafeText(analysis.topic, "image topic", MAX_TOPIC_LENGTH);
        assertSafeText(analysis.imageDescription, "image description", MAX_IMAGE_DESCRIPTION_LENGTH);
      } catch (error) {
        const providerStatusCode = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 502;
        const status = providerStatusCode === 501 ? 503 : providerStatusCode;
        await recoverOwnedRun(owner.session.id, runId);
        const response = await repository.transaction((state) => {
          const run = findOwnedRun(state, runId, owner.session.id);
          assertExpectedRevision(run, reserved.revision);
          assertActiveOperation(run, reserved.operationId, "image");
          run.status = "failed"; run.recoverable = true; run.resumeStatus = "analyzing_image";
          run.activeOperation = undefined;
          const call = run.toolCalls.find((item) => item.id === reserved.callId)!; call.status = "completed";
          run.toolResults.push({ callId: call.id, tool: "analyze_image", status: "error", error: { code: "image_provider_error", message: "Image provider request failed" } });
          run.updatedAt = now().toISOString();
          run.revision += 1;
          return asResponse(run);
        });
        throw new AgentProviderError(status, "image_provider_error", response);
      }
      await recoverOwnedRun(owner.session.id, runId);
      return repository.transaction((state) => {
        const run = findOwnedRun(state, runId, owner.session.id);
        assertExpectedRevision(run, reserved.revision);
        assertActiveOperation(run, reserved.operationId, "image");
        const merged = {
          topic: reserved.existingBrief?.topic ?? analysis.topic,
          platform: reserved.existingBrief?.platform ?? analysis.suggestedPlatform,
          contentType: reserved.existingBrief?.contentType ?? analysis.suggestedContentType,
          targetAudience: reserved.existingBrief?.targetAudience,
          emotionTone: reserved.existingBrief?.emotionTone ?? analysis.suggestedEmotionTone,
          wordLimitBand: reserved.existingBrief?.wordLimitBand,
          preferredStyle: reserved.existingBrief?.preferredStyle,
          avoidBadcaseTags: reserved.existingBrief?.avoidBadcaseTags,
          imageDescription: analysis.imageDescription,
        };
        const normalized = normalizeBrief(merged, run.clarificationAttempts ?? 0);
        const call = run.toolCalls.find((item) => item.id === reserved.callId)!;
        call.status = "completed";
        run.toolResults.push({ callId: call.id, tool: "analyze_image", status: "success", output: { analysis } });
        run.activeOperation = undefined;
        if (normalized.kind === "complete") {
          run.brief = normalized.brief;
          run.briefDraft = normalized.brief;
          run.status = "awaiting_brief_confirmation";
        } else {
          run.status = "understanding";
          if ((run.clarificationAttempts ?? 0) < 2) {
            run.clarificationAttempts = (run.clarificationAttempts ?? 0) + 1;
            run.messages.push({ id: id("message"), role: "assistant", content: questionFor(normalized.missing[0] ?? "topic"), createdAt: now().toISOString() });
          } else run.requiresFormCompletion = true;
        }
        run.updatedAt = now().toISOString();
        run.revision += 1;
        return asResponse(run);
      });
    },

    async getMemory(sessionToken: string | undefined): Promise<{ entries: CoachMemoryEntry[] }> {
      const owner = await sessionFromToken(sessionToken, false);
      const memory = listCreatorMemory(await repository.read(), owner.session.id, now());
      return { entries: memory.entries.map((entry) => ({ id: memoryId(entry.key, entry.value), ...entry })) };
    },

    async deleteMemory(sessionToken: string | undefined, entryId: string): Promise<void> {
      const owner = await sessionFromToken(sessionToken, false);
      await repository.transaction((state) => {
        const entry = listCreatorMemory(state, owner.session.id, now()).entries.find((item) => memoryId(item.key, item.value) === entryId);
        if (!entry) throw new AgentNotFoundError();
        deleteCreatorMemory(state, owner.session.id, entry.key, entry.value, now());
      });
    },

    async clearMemory(sessionToken: string | undefined): Promise<void> {
      const owner = await sessionFromToken(sessionToken, false);
      await repository.transaction((state) => deleteCreatorMemory(state, owner.session.id, undefined, undefined, now()));
    },
  };
}

export type CreativeCoachService = ReturnType<typeof createCreativeCoachService>;
