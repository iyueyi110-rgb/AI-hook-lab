import { DatabaseNotConfiguredError } from "../persistence.ts";
import { generateCoachHooks } from "../generation/coach.ts";
import { decideBriefPatch } from "../generation/decision.ts";
import { GenerationError } from "../generation/service.ts";
import { analyzeImageFile, ImageAnalysisError, MAX_IMAGE_BYTES } from "../imageAnalysis.ts";
import { AgentConflictError } from "./machine.ts";
import {
  AgentMemoryValidationError,
  AgentNotFoundError,
  CREATOR_SESSION_COOKIE,
  CREATOR_SESSION_MAX_AGE_SECONDS,
  CreatorSessionNotFoundError,
  getAgentRepository,
} from "./repository.ts";
import {
  AgentInputError,
  AgentProviderError,
  MAX_AGENT_MESSAGE_LENGTH,
  createCreativeCoachService,
  type CreativeCoachService,
} from "./service.ts";
import type { AgentCommand } from "./types.ts";

export const MAX_AGENT_JSON_BYTES = 64 * 1024;

interface HandlerOptions {
  service?: CreativeCoachService;
  enabled?: boolean;
  production?: boolean;
  env?: NodeJS.ProcessEnv;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function cookieValue(request: Request): string | undefined {
  const raw = request.headers.get("cookie") ?? "";
  for (const item of raw.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === CREATOR_SESSION_COOKIE) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

function sessionCookie(token: string, production: boolean): string {
  return `${CREATOR_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${CREATOR_SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${production ? "; Secure" : ""}`;
}

function assertSameOrigin(request: Request): void {
  const expected = new URL(request.url).origin;
  const supplied = request.headers.get("origin");
  if (!supplied || supplied !== expected) throw new HttpError(403, "Cross-origin mutation denied");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_AGENT_JSON_BYTES) throw new HttpError(413, "Request body is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_AGENT_JSON_BYTES) throw new HttpError(413, "Request body is too large");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, "Request body must be a JSON object"); }
}

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[] = []): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) {
    throw new HttpError(400, "Request contains invalid fields");
  }
}

function integer(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new HttpError(400, `${name} must be a non-negative integer`);
  return value as number;
}

function nonEmpty(value: unknown, name: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required`);
  if (value.length > max) throw new HttpError(413, `${name} is too long`);
  return value;
}

function parseCommand(value: unknown): AgentCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "command is required");
  const command = value as Record<string, unknown>;
  if (typeof command.type !== "string") throw new HttpError(400, "command.type is required");
  switch (command.type) {
    case "message":
      exactKeys(command, ["type", "text"], ["type", "text"]);
      return { type: "message", text: nonEmpty(command.text, "message", MAX_AGENT_MESSAGE_LENGTH) };
    case "confirm_brief": case "confirm_final": case "retry":
      exactKeys(command, ["type"], ["type"]);
      return { type: command.type };
    case "select_candidate":
      exactKeys(command, ["type", "candidateId"], ["type", "candidateId"]);
      return { type: "select_candidate", candidateId: nonEmpty(command.candidateId, "candidateId", 200) };
    case "rewrite_candidate":
      exactKeys(command, ["type", "candidateId", "instruction"], ["type", "candidateId"]);
      return { type: "rewrite_candidate", candidateId: nonEmpty(command.candidateId, "candidateId", 200), ...(command.instruction === undefined ? {} : { instruction: nonEmpty(command.instruction, "instruction", 1_000) }) };
    case "reject_batch":
      exactKeys(command, ["type", "reason"], ["type"]);
      return { type: "reject_batch", ...(command.reason === undefined ? {} : { reason: nonEmpty(command.reason, "reason", 1_000) }) };
    default: throw new HttpError(400, "Unknown command type");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: "request_error", message: error.message }, error.status);
  if (error instanceof AgentProviderError) return json({ ...error.response, error: error.causeCode, message: error.message }, error.status);
  if (error instanceof AgentConflictError) return json({ error: error.code, message: error.message }, 409);
  if (error instanceof AgentNotFoundError || error instanceof CreatorSessionNotFoundError) return json({ error: "not_found", message: "Agent run was not found" }, 404);
  if (error instanceof AgentInputError || error instanceof AgentMemoryValidationError) return json({ error: "validation", message: error.message }, 400);
  if (error instanceof ImageAnalysisError) return json({ error: error.title, message: error.message }, error.status);
  if (error instanceof DatabaseNotConfiguredError) return json({ error: "database_unavailable", message: error.message }, 503);
  const externalCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "53300"].includes(externalCode) || externalCode.startsWith("08")) {
    return json({ error: "database_unavailable", message: "The agent database is temporarily unavailable" }, 503);
  }
  if (error instanceof GenerationError) {
    const status = error.code === "rate_limit" ? 429 : error.code === "timeout" ? 504 : error.code === "missing_key" ? 503 : 502;
    return json({ error: error.code, message: "Generation provider failed" }, status);
  }
  return json({ error: "internal_error", message: "The creative coach could not process this request" }, 500);
}

export function createAgentHttpHandlers(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? env.NEXT_PUBLIC_AGENT_COACH_ENABLED === "true";
  const production = options.production ?? env.NODE_ENV === "production";
  let service = options.service;
  let ready: Promise<void> | undefined;

  function hidden(): Response | undefined { return enabled ? undefined : json({ error: "not_found", message: "Not found" }, 404); }
  async function getService(): Promise<CreativeCoachService> {
    if (!service) {
      const repository = getAgentRepository();
      ready = repository.initialize();
      service = createCreativeCoachService({
        repository,
        generate: (request) => generateCoachHooks(request, { apiKey: env.DEEPSEEK_API_KEY }),
        decideBriefPatch: (request) => decideBriefPatch(request, { apiKey: env.DEEPSEEK_API_KEY }),
        analyzeImage: (file) => analyzeImageFile(file, { apiKey: env.ARK_API_KEY, model: env.ARK_MODEL_ID }),
      });
    }
    if (ready) await ready;
    return service;
  }
  async function handle(operation: () => Promise<Response>): Promise<Response> {
    try { return await operation(); } catch (error) { return errorResponse(error); }
  }

  const handlers = {
    get service() { return service; },
    async createRun(request: Request): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        const body = await readJson(request);
        exactKeys(body, ["brief", "hasImage", "ignoreMemory"]);
        if (body.brief !== undefined && (!body.brief || typeof body.brief !== "object" || Array.isArray(body.brief))) throw new HttpError(400, "brief must be an object");
        if (body.hasImage !== undefined && typeof body.hasImage !== "boolean") throw new HttpError(400, "hasImage must be boolean");
        if (body.ignoreMemory !== undefined && typeof body.ignoreMemory !== "boolean") throw new HttpError(400, "ignoreMemory must be boolean");
        const result = await (await getService()).createRun(cookieValue(request), { brief: body.brief as Record<string, unknown> | undefined, hasImage: body.hasImage as boolean | undefined, ignoreMemory: body.ignoreMemory as boolean | undefined });
        return json(result.response, 200, { "Set-Cookie": sessionCookie(result.sessionToken, production), "Cache-Control": "no-store" });
      });
    },
    async getRun(request: Request, runId: string): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        return json(await (await getService()).getRun(cookieValue(request), nonEmpty(runId, "runId", 200)), 200, { "Cache-Control": "no-store" });
      });
    },
    async deleteRun(request: Request, runId: string): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        const rawRevision = new URL(request.url).searchParams.get("expectedRevision");
        if (rawRevision === null || !/^\d+$/.test(rawRevision)) throw new HttpError(400, "expectedRevision is required");
        const revision = integer(Number(rawRevision), "expectedRevision");
        return json(await (await getService()).cancelRun(cookieValue(request), nonEmpty(runId, "runId", 200), revision));
      });
    },
    async turn(request: Request, runId: string): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        const body = await readJson(request);
        exactKeys(body, ["expectedRevision", "command"], ["expectedRevision", "command"]);
        return json(await (await getService()).submitTurn(cookieValue(request), nonEmpty(runId, "runId", 200), integer(body.expectedRevision, "expectedRevision"), parseCommand(body.command)));
      });
    },
    async image(request: Request, runId: string): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        const length = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(length) && length > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, "Image request is too large");
        let form: FormData;
        try { form = await request.formData(); } catch { throw new HttpError(400, "Expected multipart form data"); }
        const file = form.get("image");
        if (!(file instanceof File)) throw new HttpError(400, "image is required");
        if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is too large");
        const revisionValue = form.get("expectedRevision");
        if (typeof revisionValue !== "string" || !/^\d+$/.test(revisionValue)) throw new HttpError(400, "expectedRevision is required");
        return json(await (await getService()).uploadImage(cookieValue(request), nonEmpty(runId, "runId", 200), integer(Number(revisionValue), "expectedRevision"), file));
      });
    },
    async getMemory(request: Request): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        const token = cookieValue(request);
        if (!token) return json({ entries: [] }, 200, { "Cache-Control": "no-store" });
        return json(await (await getService()).getMemory(token), 200, { "Cache-Control": "no-store" });
      });
    },
    async deleteMemory(request: Request, entryId: string): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        await (await getService()).deleteMemory(cookieValue(request), nonEmpty(entryId, "memoryId", 200));
        return json({ ok: true });
      });
    },
    async clearMemory(request: Request): Promise<Response> {
      return handle(async () => {
        const off = hidden(); if (off) return off;
        assertSameOrigin(request);
        await (await getService()).clearMemory(cookieValue(request));
        return json({ ok: true });
      });
    },
  };
  return handlers;
}

export const agentHttpHandlers = createAgentHttpHandlers();
