import type { EvaluationUser } from "../evaluation/types.ts";
import { DatabaseNotConfiguredError } from "../persistence.ts";
import { StrategyTransitionError } from "./domain.ts";
import {
  getStrategyService,
  StrategyConflictError,
  StrategyInputError,
  StrategyNotFoundError,
  type StrategyService,
} from "./service.ts";
import type { ContentType, Platform } from "../types.ts";
import { StrategyValidationError } from "./validation.ts";
import {
  getStrategyFromOpsService,
  StrategyFromOpsError,
  type StrategyFromOpsService,
} from "./from-ops.ts";
import { OpsProviderError } from "../agent/ops-provider.ts";
import { isPublicWorkspaceReadEnabled } from "../adminAccess.ts";

const MAX_JSON_BYTES = 32 * 1024;
const PLATFORMS = new Set<Platform>(["xiaohongshu", "douyin", "bilibili", "youtube", "x"]);
const CONTENT_TYPES = new Set<ContentType>(["video", "image-text", "product-ad", "tutorial", "opinion"]);

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

interface Options {
  service?: StrategyService;
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  currentUser?: () => Promise<EvaluationUser | null>;
  fromOpsService?: StrategyFromOpsService;
  publicReadEnabled?: boolean;
}

export function isStrategyCardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.STRATEGY_CARDS_ENABLED !== undefined) return env.STRATEGY_CARDS_ENABLED === "true";
  return env.NODE_ENV !== "production";
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "cross_origin_denied");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "request_too_large");
  if (!request.body) throw new HttpError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel("request_too_large");
      throw new HttpError(413, "request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new HttpError(400, "unsupported_field");
}

function safeError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code, message: error.code }, error.status);
  if (error instanceof StrategyValidationError) return json({ error: error.code, message: error.code }, 400);
  if (error instanceof StrategyNotFoundError) return json({ error: "strategy_not_found", message: "strategy_not_found" }, 404);
  if (error instanceof StrategyInputError) return json({ error: error.message, message: error.message }, 400);
  if (error instanceof StrategyConflictError) return json({ error: error.message, message: error.message }, 409);
  if (error instanceof StrategyTransitionError) return json({ error: error.code, message: error.code }, 409);
  if (error instanceof StrategyFromOpsError) {
    const status = error.code === "strategy_extraction_rate_limited" ? 429
      : error.code === "ops_session_not_found" ? 404
        : 400;
    return json({ error: error.code, message: error.code }, status);
  }
  if (error instanceof OpsProviderError) {
    const status = error.code === "rate_limit" ? 429
      : error.code === "timeout" ? 504
        : error.code === "missing_key" ? 503
          : 502;
    return json({ error: `strategy_extraction_${error.code}`, message: `strategy_extraction_${error.code}` }, status);
  }
  if (error instanceof DatabaseNotConfiguredError) return json({ error: "database_unavailable", message: "database_unavailable" }, 503);
  return json({ error: "internal_error", message: "internal_error" }, 500);
}

export function createStrategyHttpHandlers(options: Options = {}) {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? isStrategyCardsEnabled(env);
  const publicReadEnabled = options.publicReadEnabled ?? isPublicWorkspaceReadEnabled(env.PUBLIC_DASHBOARD_ENABLED);
  const currentUser = options.currentUser ?? (async () => (await import("../evaluation/server.ts")).getCurrentEvaluationUser());
  let service = options.service;
  let fromOpsService = options.fromOpsService;
  const getService = () => service ??= getStrategyService();
  const getFromOpsService = () => fromOpsService ??= getStrategyFromOpsService();

  const authorize = async (): Promise<EvaluationUser> => {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "unauthorized");
    if (user.role !== "admin") throw new HttpError(403, "forbidden");
    return user;
  };

  const authorizeRead = async (): Promise<void> => {
    if (!publicReadEnabled) await authorize();
  };

  const adminMutation = async <T>(request: Request, operation: (actor: EvaluationUser, body: Record<string, unknown>) => Promise<T>): Promise<Response> => {
    try {
      if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
      sameOrigin(request);
      const actor = await authorize();
      const body = await readJson(request);
      return json(await operation(actor, body));
    } catch (error) {
      return safeError(error);
    }
  };

  return {
    async listAdmin(): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
        await authorizeRead();
        return json({ strategies: await getService().list() });
      } catch (error) {
        return safeError(error);
      }
    },

    async createDraft(request: Request): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
        sameOrigin(request);
        const actor = await authorize();
        const body = await readJson(request);
        exactKeys(body, ["title", "scopePairs", "audienceLabel", "guidance", "hypothesis"]);
        const created = await getService().createDraft(actor.id, body);
        return json(created, 201);
      } catch (error) {
        return safeError(error);
      }
    },

    async createDraftFromOps(request: Request): Promise<Response> {
      return adminMutation(request, async (actor, body) => {
        exactKeys(body, ["sessionId", "assistantMessageId", "recommendationIndex"]);
        if (
          typeof body.sessionId !== "string"
          || body.sessionId.length < 1
          || body.sessionId.length > 100
          || typeof body.assistantMessageId !== "string"
          || body.assistantMessageId.length < 1
          || body.assistantMessageId.length > 200
          || !Number.isInteger(body.recommendationIndex)
          || (body.recommendationIndex as number) < 0
          || (body.recommendationIndex as number) > 100
        ) {
          throw new HttpError(400, "invalid_request");
        }
        return getFromOpsService().createDraft({
          actorId: actor.id,
          sessionId: body.sessionId,
          assistantMessageId: body.assistantMessageId,
          recommendationIndex: body.recommendationIndex as number,
        });
      });
    },

    async getVersion(_request: Request, cardId: string, version: number): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
        await authorizeRead();
        return json(await getService().get(cardId, version));
      } catch (error) {
        return safeError(error);
      }
    },

    async patchVersion(request: Request, cardId: string, version: number): Promise<Response> {
      return adminMutation(request, async (actor, body) => {
        exactKeys(body, ["expectedRevision", "content"]);
        if (!Number.isInteger(body.expectedRevision) || !body.content) throw new HttpError(400, "invalid_request");
        return getService().updateDraft(cardId, version, actor.id, body.expectedRevision as number, body.content);
      });
    },

    async actionVersion(request: Request, cardId: string, version: number): Promise<Response> {
      return adminMutation(request, async (actor, body) => {
        exactKeys(body, ["action", "expectedRevision", "expiresInDays", "reason"]);
        if (!["submit_review", "approve_experiment", "reject", "activate", "archive"].includes(String(body.action))) {
          throw new HttpError(400, "invalid_action");
        }
        if (!Number.isInteger(body.expectedRevision)) throw new HttpError(400, "invalid_revision");
        if (body.expiresInDays !== undefined && !Number.isInteger(body.expiresInDays)) throw new HttpError(400, "invalid_expiry");
        if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) throw new HttpError(400, "invalid_reason");
        return getService().action(cardId, version, actor.id, {
          action: body.action,
          expectedRevision: body.expectedRevision,
          ...(body.expiresInDays !== undefined ? { expiresInDays: body.expiresInDays } : {}),
          ...(body.reason ? { reason: body.reason } : {}),
        } as Parameters<StrategyService["action"]>[3]);
      });
    },

    async cloneVersion(request: Request, cardId: string, version: number): Promise<Response> {
      return adminMutation(request, async (actor, body) => {
        exactKeys(body, []);
        return getService().clone(cardId, version, actor.id);
      });
    },

    async diffVersion(request: Request, cardId: string, version: number): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
        await authorizeRead();
        const against = Number(new URL(request.url).searchParams.get("against"));
        if (!Number.isInteger(against) || against < 1) throw new HttpError(400, "invalid_compare_version");
        return json({ diff: await getService().diff(cardId, version, against) });
      } catch (error) {
        return safeError(error);
      }
    },

    async listActive(request: Request): Promise<Response> {
      try {
        if (!enabled) return json({ error: "not_found", message: "not_found" }, 404);
        const url = new URL(request.url);
        const platform = url.searchParams.get("platform") as Platform;
        const contentType = url.searchParams.get("contentType") as ContentType;
        if (!PLATFORMS.has(platform) || !CONTENT_TYPES.has(contentType)) throw new HttpError(400, "invalid_scope");
        return json({ strategies: await getService().listActive({ platform, contentType }) });
      } catch (error) {
        return safeError(error);
      }
    },
  };
}

export const strategyHttpHandlers = createStrategyHttpHandlers();
