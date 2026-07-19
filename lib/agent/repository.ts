import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import { DatabaseNotConfiguredError, getConfiguredDatabaseUrl, getPersistenceMode } from "../persistence.ts";
import { trimRecentMessages } from "./budget.ts";
import { recordMemory } from "./memory.ts";
import { assertExpectedRevision } from "./machine.ts";
import { AGENT_SCHEMA_SQL } from "./schema.ts";
import type { AgentRun, Memory, MemoryKey } from "./types.ts";
import type { AgentQuotaUsage } from "./quota.ts";

export const CREATOR_SESSION_COOKIE = "ai-hook-creator-session";
export const CREATOR_SESSION_COOKIE_NAME = CREATOR_SESSION_COOKIE;
export const CREATOR_SESSION_TTL_DAYS = 180;
export const CREATOR_SESSION_MAX_AGE_SECONDS = CREATOR_SESSION_TTL_DAYS * 24 * 60 * 60;
export const STALE_RUN_TTL_DAYS = 30;

export interface CreatorSession {
  id: string;
  tokenDigest: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface CreatorMemory {
  creatorSessionId: string;
  memory: Memory;
}

export interface AgentRunSummary {
  messageCount: number;
  latestMessageAt?: string;
  candidateCount: number;
  status: AgentRun["status"];
}

export interface StoredAgentRun extends AgentRun {
  creatorSessionId: string;
  createdAt: string;
  updatedAt: string;
  summary: AgentRunSummary;
}

export interface AgentState {
  schemaVersion: 1;
  creatorSessions: CreatorSession[];
  runs: StoredAgentRun[];
  memories: CreatorMemory[];
  usage?: AgentQuotaUsage[];
}

export interface AgentCleanupResult {
  removedRunIds: string[];
  removedSessionIds: string[];
  removedMemoryCount: number;
  removedUsageCount: number;
}

export interface AgentRepository {
  initialize(): Promise<void>;
  read(): Promise<AgentState>;
  transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T>;
  cleanup(now?: Date): Promise<AgentCleanupResult>;
  readonly mode: "postgres" | "json";
}

export class AgentNotFoundError extends Error {
  readonly code = "agent_not_found" as const;
  constructor() {
    super("Agent run was not found");
    this.name = "AgentNotFoundError";
  }
}

export class CreatorSessionNotFoundError extends Error {
  readonly code = "creator_session_not_found" as const;
  constructor() {
    super("Creator session was not found");
    this.name = "CreatorSessionNotFoundError";
  }
}

export class AgentMemoryValidationError extends Error {
  readonly code = "agent_memory_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "AgentMemoryValidationError";
  }
}

export class UnsupportedAgentSchemaError extends Error {
  readonly code = "agent_schema_unsupported" as const;
  constructor(schemaVersion: unknown, storedSchemaVersion?: unknown) {
    super(`Unsupported agent schema version ${String(schemaVersion)}${storedSchemaVersion === undefined ? "" : ` (stored ${String(storedSchemaVersion)})`}`);
    this.name = "UnsupportedAgentSchemaError";
  }
}

export function createInitialAgentState(): AgentState {
  return { schemaVersion: 1, creatorSessions: [], runs: [], memories: [], usage: [] };
}

export function hashCreatorSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso(now: Date): string { return now.toISOString(); }
function expiresAt(now: Date): string {
  const expires = new Date(now);
  expires.setUTCDate(expires.getUTCDate() + CREATOR_SESSION_TTL_DAYS);
  return nowIso(expires);
}

export function createCreatorSession(state: AgentState, now = new Date()): { token: string; session: CreatorSession } {
  const token = randomBytes(32).toString("base64url");
  const session: CreatorSession = {
    id: randomBytes(16).toString("base64url"), tokenDigest: hashCreatorSessionToken(token),
    createdAt: nowIso(now), expiresAt: expiresAt(now), lastSeenAt: nowIso(now),
  };
  state.creatorSessions.push(session);
  return { token, session };
}

export function resolveCreatorSession(state: AgentState, token: string | undefined, now = new Date()): CreatorSession | undefined {
  if (!token) return undefined;
  const digest = hashCreatorSessionToken(token);
  const session = state.creatorSessions.find((item) => item.tokenDigest === digest && Date.parse(item.expiresAt) > now.getTime());
  if (session) session.lastSeenAt = nowIso(now);
  return session;
}

function requireActiveCreatorSession(state: AgentState, creatorSessionId: string, now = new Date()): CreatorSession {
  const session = state.creatorSessions.find((item) => item.id === creatorSessionId && Date.parse(item.expiresAt) > now.getTime());
  if (!session) throw new CreatorSessionNotFoundError();
  return session;
}

const MEMORY_KEYS: readonly MemoryKey[] = ["default_platform", "preferred_style", "avoided_style", "preferred_tone", "word_limit_band", "avoid_badcase_tag"];

function assertMemoryKey(key: unknown): asserts key is MemoryKey {
  if (typeof key !== "string" || !MEMORY_KEYS.includes(key as MemoryKey)) {
    throw new AgentMemoryValidationError("Memory key is not allowed");
  }
}

export function findOwnedRun(state: AgentState, runId: string, creatorSessionId: string): StoredAgentRun {
  const run = state.runs.find((item) => item.id === runId && item.creatorSessionId === creatorSessionId);
  if (!run) throw new AgentNotFoundError();
  return run;
}

export function assertOwnedRunRevision(state: AgentState, runId: string, creatorSessionId: string, expectedRevision: number): StoredAgentRun {
  const run = findOwnedRun(state, runId, creatorSessionId);
  assertExpectedRevision(run, expectedRevision);
  return run;
}

export function listCreatorMemory(state: AgentState, creatorSessionId: string, now = new Date()): Memory {
  requireActiveCreatorSession(state, creatorSessionId, now);
  return state.memories.find((item) => item.creatorSessionId === creatorSessionId)?.memory ?? { entries: [] };
}

export function recordCreatorMemory(state: AgentState, creatorSessionId: string, update: { key: MemoryKey; value: string }, now = new Date()): { memory: Memory; accepted: boolean } {
  requireActiveCreatorSession(state, creatorSessionId, now);
  assertMemoryKey(update.key);
  const current = state.memories.find((item) => item.creatorSessionId === creatorSessionId)?.memory ?? { entries: [] };
  const result = recordMemory({ id: "memory", revision: 0, status: "understanding", messages: [], candidates: [], toolCalls: [], toolResults: [], approvals: [], memory: current, revisionRounds: 0 }, 0, update);
  if (result.accepted) {
    const existing = state.memories.find((item) => item.creatorSessionId === creatorSessionId);
    if (existing) existing.memory = result.run.memory;
    else state.memories.push({ creatorSessionId, memory: result.run.memory });
  }
  return { memory: result.run.memory, accepted: result.accepted };
}

export function deleteCreatorMemory(state: AgentState, creatorSessionId: string, key?: MemoryKey, value?: string, now = new Date()): void {
  requireActiveCreatorSession(state, creatorSessionId, now);
  if (key !== undefined) assertMemoryKey(key);
  const entry = state.memories.find((item) => item.creatorSessionId === creatorSessionId);
  if (!entry) return;
  if (!key) { entry.memory = { entries: [] }; return; }
  entry.memory = { entries: entry.memory.entries.filter((item) => item.key !== key || (value !== undefined && item.value !== value)) };
}

function validFutureDate(value: string | undefined, now: Date): boolean {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed > now.getTime();
}

export function cleanupExpiredAgentData(state: AgentState, now = new Date()): AgentCleanupResult {
  const threshold = now.getTime() - STALE_RUN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const removedSessionIds = new Set(state.creatorSessions
    .filter((session) => !validFutureDate(session.expiresAt, now))
    .map((session) => session.id));
  const knownSessionIds = new Set(state.creatorSessions.map((session) => session.id));
  const removedRunIds = new Set(state.runs
    .filter((run) => {
      if (removedSessionIds.has(run.creatorSessionId)) return true;
      // Production runs always have an owning session. Preserve legacy/orphan
      // records here so a migration can handle them explicitly instead of
      // silently deleting unknown data.
      if (!knownSessionIds.has(run.creatorSessionId)) return false;
      const updatedAt = Date.parse(run.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt >= threshold) return false;
      return !run.activeOperation || !validFutureDate(run.activeOperation.expiresAt, now);
    })
    .map((run) => run.id));
  const previousMemoryCount = state.memories.length;
  const previousUsageCount = state.usage?.length ?? 0;
  const expiredSessionDigests = new Set(state.creatorSessions.filter((session) => removedSessionIds.has(session.id)).map((session) => session.tokenDigest));
  state.creatorSessions = state.creatorSessions.filter((session) => !removedSessionIds.has(session.id));
  state.runs = state.runs.filter((run) => !removedRunIds.has(run.id));
  state.memories = state.memories.filter((memory) => !removedSessionIds.has(memory.creatorSessionId));
  state.usage = (state.usage ?? []).filter((usage) => {
    if (usage.scopeType === "session" && expiredSessionDigests.has(usage.scopeId)) return false;
    const startedAt = Date.parse(usage.windowStartedAt);
    return Number.isFinite(startedAt) && startedAt >= threshold;
  });
  return {
    removedRunIds: [...removedRunIds],
    removedSessionIds: [...removedSessionIds],
    removedMemoryCount: previousMemoryCount - state.memories.length,
    removedUsageCount: previousUsageCount - state.usage.length,
  };
}

/** @deprecated Use cleanupExpiredAgentData for run and session retention. */
export function cleanupStaleRuns(state: AgentState, now = new Date()): string[] {
  return cleanupExpiredAgentData(state, now).removedRunIds;
}

function summaryFor(run: StoredAgentRun, originalMessageCount = run.messages.length): AgentRunSummary {
  return { messageCount: Math.max(run.summary?.messageCount ?? 0, originalMessageCount), latestMessageAt: run.messages.at(-1)?.createdAt ?? run.summary?.latestMessageAt, candidateCount: run.candidates.length, status: run.status };
}

const DATA_URI = /^data:[^,]*;base64,/i;

function hasPrefix(value: Uint8Array, bytes: number[]): boolean {
  return bytes.every((byte, index) => value[index] === byte);
}

function isEncodedBinaryPayload(value: string): boolean {
  if (value.length < 8 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) || value.includes("=") && !/=+$/.test(value)) return false;
  const unpadded = value.replace(/=/g, "");
  if (unpadded.length % 4 === 1) return false;
  const standard = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="), "base64");
  return hasPrefix(decoded, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    || hasPrefix(decoded, [0xff, 0xd8, 0xff])
    || hasPrefix(decoded, [0x47, 0x49, 0x46, 0x38])
    || hasPrefix(decoded, [0x25, 0x50, 0x44, 0x46, 0x2d])
    || (hasPrefix(decoded, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(decoded.subarray(8), [0x57, 0x45, 0x42, 0x50]));
}

function stripBinaryPayload(value: unknown): unknown {
  if (typeof value === "string") return DATA_URI.test(value) || isEncodedBinaryPayload(value) ? undefined : value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return undefined;
  if (Array.isArray(value)) return value.map((item) => stripBinaryPayload(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const normalizedKey = childKey.toLowerCase();
    if (normalizedKey.includes("base64") || normalizedKey.includes("binary") || (normalizedKey.includes("image") && normalizedKey !== "imagedescription")) continue;
    const child = stripBinaryPayload(childValue);
    if (child !== undefined) clean[childKey] = child;
  }
  return clean;
}

export function validateAgentState(state: unknown, storedSchemaVersion?: unknown): asserts state is AgentState {
  const schemaVersion = typeof state === "object" && state !== null ? (state as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (schemaVersion !== 1 || (storedSchemaVersion !== undefined && storedSchemaVersion !== schemaVersion)) {
    throw new UnsupportedAgentSchemaError(schemaVersion, storedSchemaVersion);
  }
}

function normalizeState(state: AgentState, now = new Date()): void {
  validateAgentState(state);
  state.usage ??= [];
  cleanupExpiredAgentData(state, now);
  state.runs = state.runs.map((run) => {
    const originalMessageCount = run.messages.length;
    const messages = trimRecentMessages(run.messages);
    const trimmed = { ...run, messages };
    const safeRun = stripBinaryPayload(trimmed) as StoredAgentRun;
    return { ...safeRun, summary: summaryFor(safeRun, originalMessageCount) };
  });
  const cleanState = stripBinaryPayload(state) as AgentState;
  for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
  Object.assign(state, cleanState);
  validateAgentState(state);
}

export class MemoryAgentRepository implements AgentRepository {
  readonly mode = "json" as const;
  private state = createInitialAgentState();
  private queue: Promise<void> = Promise.resolve();
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  async initialize(): Promise<void> { return this.enqueue(async () => { normalizeState(this.state); }); }
  async read(): Promise<AgentState> {
    return this.enqueue(async () => { normalizeState(this.state); return structuredClone(this.state); });
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const draft = structuredClone(this.state);
      validateAgentState(draft);
      const result = await mutator(draft);
      validateAgentState(draft);
      normalizeState(draft);
      this.state = draft;
      return result;
    });
  }
  async cleanup(now = new Date()): Promise<AgentCleanupResult> {
    return this.transaction((state) => cleanupExpiredAgentData(state, now));
  }
}

// This serializes same-file repositories only within one Node.js process. Multi-process writers must use PostgreSQL.
const JSON_FILE_QUEUES = new Map<string, Promise<void>>();

function enqueueJson<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = JSON_FILE_QUEUES.get(filePath) ?? Promise.resolve();
  const task = previous.then(operation, operation);
  JSON_FILE_QUEUES.set(filePath, task.then(() => undefined, () => undefined));
  return task;
}

export class JsonAgentRepository implements AgentRepository {
  readonly mode = "json" as const;
  private readonly filePath: string;
  constructor(filePath = path.join(process.cwd(), "data", "agent-store.json")) { this.filePath = path.resolve(filePath); }
  async initialize(): Promise<void> {
    await enqueueJson(this.filePath, async () => { await this.loadAndPersist(); });
  }
  async read(): Promise<AgentState> {
    return enqueueJson(this.filePath, () => this.loadAndPersist());
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    return enqueueJson(this.filePath, async () => {
      const state = await this.loadAndPersist();
      validateAgentState(state);
      const value = await mutator(state);
      validateAgentState(state);
      normalizeState(state);
      await this.write(state);
      return value;
    });
  }
  async cleanup(now = new Date()): Promise<AgentCleanupResult> {
    return this.transaction((state) => cleanupExpiredAgentData(state, now));
  }
  private async loadAndPersist(): Promise<AgentState> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    let state: AgentState;
    try { state = JSON.parse(await readFile(this.filePath, "utf8")) as AgentState; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = createInitialAgentState();
    }
    validateAgentState(state);
    normalizeState(state);
    await this.write(state);
    return state;
  }
  private async write(state: AgentState): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}

export class PostgresAgentRepository implements AgentRepository {
  readonly mode = "postgres" as const;
  private readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString, max: 5 }); }
  async initialize(): Promise<void> {
    await this.pool.query(AGENT_SCHEMA_SQL);
    const state = createInitialAgentState();
    await this.pool.query("INSERT INTO agent_state (id, schema_version, payload) VALUES ('default', $1, $2::jsonb) ON CONFLICT (id) DO NOTHING", [state.schemaVersion, JSON.stringify(state)]);
    await this.transaction(() => undefined);
  }
  async read(): Promise<AgentState> {
    return this.transaction((state) => {
      normalizeState(state);
      return structuredClone(state);
    });
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ payload: AgentState; schema_version: number }>("SELECT schema_version, payload FROM agent_state WHERE id = 'default' FOR UPDATE");
      if (!result.rows[0]) throw new Error("Agent store is not initialized");
      const state = result.rows[0].payload;
      validateAgentState(state, result.rows[0].schema_version);
      const value = await mutator(state);
      validateAgentState(state, result.rows[0].schema_version);
      normalizeState(state);
      await client.query("UPDATE agent_state SET schema_version = $1, payload = $2::jsonb, updated_at = NOW() WHERE id = 'default'", [state.schemaVersion, JSON.stringify(state)]);
      await syncProjection(client, state);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async cleanup(now = new Date()): Promise<AgentCleanupResult> {
    return this.transaction((state) => cleanupExpiredAgentData(state, now));
  }
}

async function replaceRows(client: PoolClient, table: string, rows: Array<{ query: string; values: unknown[] }>): Promise<void> {
  await client.query(`DELETE FROM ${table}`);
  for (const row of rows) await client.query(row.query, row.values);
}

async function syncProjection(client: PoolClient, state: AgentState): Promise<void> {
  await replaceRows(client, "creator_session", state.creatorSessions.map((item) => ({ query: "INSERT INTO creator_session (id, token_digest, expires_at, last_seen_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb)", values: [item.id, item.tokenDigest, item.expiresAt, item.lastSeenAt, JSON.stringify(item)] })));
  await replaceRows(client, "agent_run", state.runs.map((item) => ({ query: "INSERT INTO agent_run (id, creator_session_id, revision, status, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", values: [item.id, item.creatorSessionId, item.revision, item.status, item.updatedAt, JSON.stringify(item)] })));
  await replaceRows(client, "agent_message", state.runs.flatMap((run) => run.messages.map((item) => ({ query: "INSERT INTO agent_message (id, run_id, role, created_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb)", values: [item.id, run.id, item.role, item.createdAt, JSON.stringify(item)] }))));
  await replaceRows(client, "agent_candidate", state.runs.flatMap((run) => run.candidates.map((item) => ({ query: "INSERT INTO agent_candidate (id, run_id, payload) VALUES ($1,$2,$3::jsonb)", values: [item.id, run.id, JSON.stringify(item)] }))));
  await replaceRows(client, "agent_tool_call", state.runs.flatMap((run) => buildToolCallProjection(run).map((item) => ({ query: "INSERT INTO agent_tool_call (id, run_id, tool, status, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", values: [item.id, run.id, item.tool, item.status, item.createdAt, JSON.stringify(item)] }))));
  await replaceRows(client, "agent_approval", state.runs.flatMap((run) => run.approvals.map((item) => ({ query: "INSERT INTO agent_approval (id, run_id, tool, status, requested_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", values: [item.id, run.id, item.tool, item.status, item.requestedAt, JSON.stringify(item)] }))));
  await replaceRows(client, "creator_memory", state.memories.flatMap((owner) => owner.memory.entries.map((item) => ({ query: "INSERT INTO creator_memory (creator_session_id, memory_key, memory_value, confidence, payload) VALUES ($1,$2,$3,$4,$5::jsonb)", values: [owner.creatorSessionId, item.key, item.value, item.confidence, JSON.stringify(item)] }))));
}

export function buildToolCallProjection(run: StoredAgentRun): Array<AgentRun["toolCalls"][number] & { result?: AgentRun["toolResults"][number] }> {
  const byCallId = new Map(run.toolResults.filter((result) => result.callId).map((result) => [result.callId!, result]));
  const legacyByTool = new Map<AgentRun["toolResults"][number]["tool"], AgentRun["toolResults"][number][]>();
  for (const result of run.toolResults) {
    if (result.callId) continue;
    const queue = legacyByTool.get(result.tool) ?? [];
    queue.push(result);
    legacyByTool.set(result.tool, queue);
  }
  return run.toolCalls.map((call) => {
    const identified = byCallId.get(call.id);
    const result = identified?.tool === call.tool ? identified : legacyByTool.get(call.tool)?.shift();
    return { ...call, result };
  });
}

let singleton: AgentRepository | undefined;
export function getAgentRepository(): AgentRepository {
  if (!singleton) {
    const mode = getPersistenceMode();
    if (mode === "unavailable") throw new DatabaseNotConfiguredError();
    singleton = mode === "postgres" ? new PostgresAgentRepository(getConfiguredDatabaseUrl()!) : new JsonAgentRepository(process.env.AGENT_STORE_PATH || undefined);
  }
  return singleton;
}
