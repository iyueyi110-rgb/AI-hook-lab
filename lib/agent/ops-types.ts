import type { DataOrigin } from "../evaluation/types";

export type OpsAgentStatus = "complete" | "needs_clarification" | "partial";

export interface OpsAgentSource {
  id: string;
  label: string;
  origin: DataOrigin;
  asOf: string;
  window?: { from: string; to: string };
  filters: Record<string, string>;
}

export interface OpsAgentAnswer {
  status: OpsAgentStatus;
  summary: string;
  sources: OpsAgentSource[];
  findings: Array<{ title: string; detail: string; sourceIds: string[] }>;
  risks: string[];
  recommendations: Array<{
    priority: "P0" | "P1" | "P2";
    action: string;
    rationale: string;
    sourceIds: string[];
  }>;
  caveats: string[];
  followUpQuestions: string[];
}

export type OpsToolName =
  | "getDashboardSummary"
  | "listEvaluationRuns"
  | "getEvaluationReport"
  | "getBadCaseAnalysis"
  | "comparePromptVersions"
  | "getPromptVersionHistory";

export interface OpsToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface OpsToolSuccess {
  status: "success";
  tool: OpsToolName;
  source: OpsAgentSource;
  sampleSize: number;
  caveats: string[];
  data: unknown;
}

export interface OpsToolFailure {
  status: "error";
  tool: string;
  error: {
    code: "unknown_tool" | "invalid_arguments" | "permission_denied" | "not_found" | "timeout" | "budget_exceeded" | "internal_error";
    message: string;
    retryable: boolean;
  };
}

export type OpsToolObservation = OpsToolSuccess | OpsToolFailure;

export interface OpsAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: OpsAgentAnswer;
  createdAt: string;
}

export interface OpsToolEvent {
  callId: string;
  tool: string;
  status: "success" | "error";
  argsHash: string;
  sourceId?: string;
  createdAt: string;
  durationMs: number;
}

export interface OpsTrace {
  id: string;
  model: string;
  startedAt: string;
  finishedAt?: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  finalStatus?: OpsAgentStatus | "error";
  stopReason?: string;
}

export interface OpsAgentSession {
  id: string;
  ownerUserId: string;
  revision: number;
  status: "idle" | "running";
  leaseUntil?: string;
  activeContext: Record<string, string>;
  messages: OpsAgentMessage[];
  toolEvents: OpsToolEvent[];
  traces: OpsTrace[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export class OpsAnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsAnswerValidationError";
  }
}

export function parseOpsAgentAnswer(value: unknown, successfulSourceIds: ReadonlySet<string>): OpsAgentAnswer {
  if (!isRecord(value)) throw new OpsAnswerValidationError("answer must be an object");
  const status = value.status;
  if (!(["complete", "needs_clarification", "partial"] as const).includes(status as OpsAgentStatus)) {
    throw new OpsAnswerValidationError("answer.status is invalid");
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    throw new OpsAnswerValidationError("answer.summary is required");
  }
  if (!Array.isArray(value.sources) || !Array.isArray(value.findings) || !Array.isArray(value.recommendations)) {
    throw new OpsAnswerValidationError("answer arrays are required");
  }
  if (!stringArray(value.risks) || !stringArray(value.caveats) || !stringArray(value.followUpQuestions)) {
    throw new OpsAnswerValidationError("answer text arrays are invalid");
  }

  const sources: OpsAgentSource[] = value.sources.map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || !successfulSourceIds.has(raw.id)) {
      throw new OpsAnswerValidationError("answer contains an unknown source id");
    }
    if (typeof raw.label !== "string" || typeof raw.asOf !== "string" || !isRecord(raw.filters)) {
      throw new OpsAnswerValidationError("answer source is invalid");
    }
    if (!(["real_user", "evaluation_set", "simulation"] as const).includes(raw.origin as DataOrigin)) {
      throw new OpsAnswerValidationError("answer source origin is invalid");
    }
    const filters = Object.fromEntries(Object.entries(raw.filters).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const window = isRecord(raw.window) && typeof raw.window.from === "string" && typeof raw.window.to === "string"
      ? { from: raw.window.from, to: raw.window.to }
      : undefined;
    return { id: raw.id, label: raw.label, origin: raw.origin as DataOrigin, asOf: raw.asOf, filters, ...(window ? { window } : {}) };
  });

  const validateSourceIds = (raw: unknown): string[] => {
    if (!stringArray(raw) || raw.some((id) => !successfulSourceIds.has(id))) {
      throw new OpsAnswerValidationError("claim contains an unknown source id");
    }
    return raw;
  };
  const findings = value.findings.map((raw) => {
    if (!isRecord(raw) || typeof raw.title !== "string" || typeof raw.detail !== "string") {
      throw new OpsAnswerValidationError("finding is invalid");
    }
    const sourceIds = validateSourceIds(raw.sourceIds);
    if (/\d/.test(raw.detail) && sourceIds.length === 0) {
      throw new OpsAnswerValidationError("numeric findings require a source");
    }
    return { title: raw.title, detail: raw.detail, sourceIds };
  });
  const recommendations = value.recommendations.map((raw) => {
    if (!isRecord(raw) || !(["P0", "P1", "P2"] as const).includes(raw.priority as "P0") || typeof raw.action !== "string" || typeof raw.rationale !== "string") {
      throw new OpsAnswerValidationError("recommendation is invalid");
    }
    return { priority: raw.priority as "P0" | "P1" | "P2", action: raw.action, rationale: raw.rationale, sourceIds: validateSourceIds(raw.sourceIds) };
  });
  if (status === "complete" && successfulSourceIds.size === 0) {
    throw new OpsAnswerValidationError("complete answers require successful evidence");
  }
  return {
    status: status as OpsAgentStatus,
    summary: value.summary,
    sources,
    findings,
    risks: value.risks,
    recommendations,
    caveats: value.caveats,
    followUpQuestions: value.followUpQuestions,
  };
}

export function partialOpsAnswer(summary: string, observations: OpsToolSuccess[] = []): OpsAgentAnswer {
  return {
    status: "partial",
    summary,
    sources: observations.map((item) => item.source),
    findings: [],
    risks: [],
    recommendations: [],
    caveats: ["本次分析在运行预算或上游服务限制内未能完成。"],
    followUpQuestions: [],
  };
}
