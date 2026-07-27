import type { AgentState, CreatorSession } from "./repository.ts";

export type AgentQuotaKind = "run_create" | "model_call" | "image_call";
export type QuotaKind = AgentQuotaKind | "classic_generation";
export type AgentQuotaScopeType = "session" | "ip";

export interface AgentQuotaUsage {
  scopeType: AgentQuotaScopeType;
  scopeId: string;
  kind: QuotaKind;
  windowStartedAt: string;
  count: number;
}

export interface AgentRequestContext {
  ipDigest: string;
}

export interface AgentQuotaConfig {
  windowMs: number;
  sessionRunCreates: number;
  ipRunCreates: number;
  sessionModelCalls: number;
  ipModelCalls: number;
  sessionImageCalls: number;
  ipImageCalls: number;
  maxActiveRunsPerSession: number;
}

export const DEFAULT_AGENT_QUOTA: AgentQuotaConfig = Object.freeze({
  windowMs: 60 * 60 * 1000,
  sessionRunCreates: 10,
  ipRunCreates: 30,
  sessionModelCalls: 30,
  ipModelCalls: 100,
  sessionImageCalls: 10,
  ipImageCalls: 30,
  maxActiveRunsPerSession: 3,
});

export class AgentQuotaError extends Error {
  readonly code = "agent_quota_exceeded" as const;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Creative Agent quota exceeded");
    this.name = "AgentQuotaError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function quotaConfigFromEnv(env: NodeJS.ProcessEnv): AgentQuotaConfig {
  return {
    windowMs: positiveInteger(env.AGENT_QUOTA_WINDOW_SECONDS, DEFAULT_AGENT_QUOTA.windowMs / 1000) * 1000,
    sessionRunCreates: positiveInteger(env.AGENT_QUOTA_SESSION_RUNS, DEFAULT_AGENT_QUOTA.sessionRunCreates),
    ipRunCreates: positiveInteger(env.AGENT_QUOTA_IP_RUNS, DEFAULT_AGENT_QUOTA.ipRunCreates),
    sessionModelCalls: positiveInteger(env.AGENT_QUOTA_SESSION_MODEL_CALLS, DEFAULT_AGENT_QUOTA.sessionModelCalls),
    ipModelCalls: positiveInteger(env.AGENT_QUOTA_IP_MODEL_CALLS, DEFAULT_AGENT_QUOTA.ipModelCalls),
    sessionImageCalls: positiveInteger(env.AGENT_QUOTA_SESSION_IMAGE_CALLS, DEFAULT_AGENT_QUOTA.sessionImageCalls),
    ipImageCalls: positiveInteger(env.AGENT_QUOTA_IP_IMAGE_CALLS, DEFAULT_AGENT_QUOTA.ipImageCalls),
    maxActiveRunsPerSession: positiveInteger(env.AGENT_QUOTA_MAX_ACTIVE_RUNS, DEFAULT_AGENT_QUOTA.maxActiveRunsPerSession),
  };
}

function limitFor(config: AgentQuotaConfig, scopeType: AgentQuotaScopeType, kind: AgentQuotaKind): number {
  if (kind === "run_create") return scopeType === "session" ? config.sessionRunCreates : config.ipRunCreates;
  if (kind === "model_call") return scopeType === "session" ? config.sessionModelCalls : config.ipModelCalls;
  return scopeType === "session" ? config.sessionImageCalls : config.ipImageCalls;
}

function retryAfter(windowStartedAt: string, now: Date, windowMs: number): number {
  const remaining = Date.parse(windowStartedAt) + windowMs - now.getTime();
  return Math.max(1, Math.ceil(remaining / 1000));
}

export function consumeIpQuota(
  state: AgentState,
  context: AgentRequestContext,
  kind: QuotaKind,
  now: Date,
  config: { windowMs: number; limit: number },
): void {
  if (!/^[a-f0-9]{64}$/i.test(context.ipDigest)) {
    throw new AgentQuotaError(Math.ceil(config.windowMs / 1000));
  }
  state.usage ??= [];
  let bucket = state.usage.find(
    (item) => item.scopeType === "ip" && item.scopeId === context.ipDigest && item.kind === kind,
  );
  if (!bucket) {
    bucket = {
      scopeType: "ip",
      scopeId: context.ipDigest,
      kind,
      windowStartedAt: now.toISOString(),
      count: 0,
    };
    state.usage.push(bucket);
  }
  const startedAt = Date.parse(bucket.windowStartedAt);
  if (!Number.isFinite(startedAt) || now.getTime() - startedAt >= config.windowMs) {
    bucket.windowStartedAt = now.toISOString();
    bucket.count = 0;
  }
  if (bucket.count >= config.limit) {
    throw new AgentQuotaError(retryAfter(bucket.windowStartedAt, now, config.windowMs));
  }
  bucket.count += 1;
}

export function consumeAgentQuota(
  state: AgentState,
  session: CreatorSession,
  context: AgentRequestContext,
  kind: AgentQuotaKind,
  now = new Date(),
  config: AgentQuotaConfig = DEFAULT_AGENT_QUOTA,
): void {
  if (!/^[a-f0-9]{64}$/i.test(context.ipDigest)) throw new AgentQuotaError(Math.ceil(config.windowMs / 1000));
  state.usage ??= [];
  if (kind === "run_create") {
    const activeRuns = state.runs.filter((run) => run.creatorSessionId === session.id && !["completed", "failed", "cancelled"].includes(run.status)).length;
    if (activeRuns >= config.maxActiveRunsPerSession) throw new AgentQuotaError(Math.ceil(config.windowMs / 1000));
  }
  const scopes: Array<{ scopeType: AgentQuotaScopeType; scopeId: string }> = [
    { scopeType: "session", scopeId: session.tokenDigest },
    { scopeType: "ip", scopeId: context.ipDigest },
  ];
  const buckets = scopes.map(({ scopeType, scopeId }) => {
    let bucket = state.usage!.find((item) => item.scopeType === scopeType && item.scopeId === scopeId && item.kind === kind);
    if (!bucket) {
      bucket = { scopeType, scopeId, kind, windowStartedAt: now.toISOString(), count: 0 };
      state.usage!.push(bucket);
    }
    if (!Number.isFinite(Date.parse(bucket.windowStartedAt)) || now.getTime() - Date.parse(bucket.windowStartedAt) >= config.windowMs) {
      bucket.windowStartedAt = now.toISOString();
      bucket.count = 0;
    }
    return bucket;
  });
  for (const bucket of buckets) {
    if (bucket.count >= limitFor(config, bucket.scopeType, kind)) {
      throw new AgentQuotaError(retryAfter(bucket.windowStartedAt, now, config.windowMs));
    }
  }
  for (const bucket of buckets) bucket.count += 1;
}
