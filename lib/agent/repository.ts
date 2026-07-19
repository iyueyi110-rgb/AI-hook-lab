import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import { DatabaseNotConfiguredError, getConfiguredDatabaseUrl, getPersistenceMode } from "../persistence.ts";
import { trimRecentMessages } from "./budget.ts";
import { recordMemory } from "./memory.ts";
import { assertExpectedRevision } from "./machine.ts";
import { runAgentMigrations } from "./migrations.ts";
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
  nextCursor?: string;
}

export interface AgentCleanupOptions {
  cursor?: string;
  limit?: number;
}

export interface AgentRepositoryScope {
  sessionDigest?: string;
  ipDigest?: string;
}

export interface AgentRepository {
  initialize(): Promise<void>;
  read(scope?: AgentRepositoryScope): Promise<AgentState>;
  transaction<T>(mutator: (state: AgentState) => T | Promise<T>, scope?: AgentRepositoryScope): Promise<T>;
  cleanup(now?: Date, options?: AgentCleanupOptions): Promise<AgentCleanupResult>;
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

export function createCreatorSession(state: AgentState, now = new Date(), suppliedToken?: string): { token: string; session: CreatorSession } {
  const token = suppliedToken ?? randomBytes(32).toString("base64url");
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
  const removedRunIds = new Set(state.runs
    .filter((run) => {
      if (removedSessionIds.has(run.creatorSessionId)) return true;
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
  const liveSessionIds = new Set(state.creatorSessions.map((session) => session.id));
  const liveSessionDigests = new Set(state.creatorSessions.map((session) => session.tokenDigest));
  state.memories = state.memories.filter((memory) => liveSessionIds.has(memory.creatorSessionId));
  state.usage = (state.usage ?? []).filter((usage) => {
    if (usage.scopeType === "session" && expiredSessionDigests.has(usage.scopeId)) return false;
    if (usage.scopeType === "session" && !liveSessionDigests.has(usage.scopeId)) return false;
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

function normalizeState(state: AgentState): void {
  validateAgentState(state);
  state.usage ??= [];
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
    await runAgentMigrations(this.pool);
  }
  async read(scope?: AgentRepositoryScope): Promise<AgentState> {
    const keys = shardKeys(scope);
    const result = keys.length
      ? await this.pool.query<{ payload: AgentState; schema_version: number }>("SELECT schema_version, payload FROM agent_state WHERE id = ANY($1::text[]) ORDER BY id", [keys])
      : await this.pool.query<{ payload: AgentState; schema_version: number }>("SELECT schema_version, payload FROM agent_state WHERE id LIKE 'session:%' OR id LIKE 'ip:%' ORDER BY id");
    const state = mergeShardRows(result.rows);
    normalizeState(state);
    return state;
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>, scope?: AgentRepositoryScope): Promise<T> {
    const keys = shardKeys(scope);
    if (!keys.length) throw new Error("PostgreSQL Agent transactions require a session or IP scope");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const key of keys) {
        await client.query(
          "INSERT INTO agent_state (id, schema_version, payload) VALUES ($1, 1, $2::jsonb) ON CONFLICT (id) DO NOTHING",
          [key, JSON.stringify(createInitialAgentState())],
        );
      }
      const result = await client.query<{ id: string; payload: AgentState; schema_version: number }>(
        "SELECT id, schema_version, payload FROM agent_state WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE",
        [keys],
      );
      const before = mergeShardRows(result.rows);
      const state = structuredClone(before);
      const value = await mutator(state);
      validateAgentState(state);
      normalizeState(state);
      for (const key of keys) {
        const payload = stateForShard(state, key);
        if (isEmptyShard(payload)) await client.query("DELETE FROM agent_state WHERE id = $1", [key]);
        else await client.query(
          "UPDATE agent_state SET schema_version = 1, payload = $2::jsonb, updated_at = NOW() WHERE id = $1",
          [key, JSON.stringify(payload)],
        );
      }
      if (scope?.sessionDigest) await syncSessionProjection(client, before, state, scope.sessionDigest);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async cleanup(now = new Date(), options: AgentCleanupOptions = {}): Promise<AgentCleanupResult> {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    const cursor = options.cursor ?? "";
    const rows = await this.pool.query<{ id: string }>(
      "SELECT id FROM agent_state WHERE (id LIKE 'session:%' OR id LIKE 'ip:%') AND id > $1 ORDER BY id LIMIT $2",
      [cursor, limit],
    );
    const total: AgentCleanupResult = { removedRunIds: [], removedSessionIds: [], removedMemoryCount: 0, removedUsageCount: 0 };
    for (const row of rows.rows) {
      const scope = row.id.startsWith("session:") ? { sessionDigest: row.id.slice(8) } : { ipDigest: row.id.slice(3) };
      const result = await this.transaction((state) => cleanupExpiredAgentData(state, now), scope);
      total.removedRunIds.push(...result.removedRunIds);
      total.removedSessionIds.push(...result.removedSessionIds);
      total.removedMemoryCount += result.removedMemoryCount;
      total.removedUsageCount += result.removedUsageCount;
    }
    if (rows.rows.length === limit) total.nextCursor = rows.rows.at(-1)!.id;
    return total;
  }
}

function shardKeys(scope?: AgentRepositoryScope): string[] {
  return [
    ...(scope?.sessionDigest ? [`session:${scope.sessionDigest}`] : []),
    ...(scope?.ipDigest ? [`ip:${scope.ipDigest}`] : []),
  ].sort();
}

function mergeShardRows(rows: Array<{ payload: AgentState; schema_version: number }>): AgentState {
  const state = createInitialAgentState();
  for (const row of rows) {
    validateAgentState(row.payload, row.schema_version);
    state.creatorSessions.push(...row.payload.creatorSessions);
    state.runs.push(...row.payload.runs);
    state.memories.push(...row.payload.memories);
    state.usage!.push(...(row.payload.usage ?? []));
  }
  return state;
}

function stateForShard(state: AgentState, key: string): AgentState {
  const shard = createInitialAgentState();
  if (key.startsWith("ip:")) {
    const digest = key.slice(3);
    shard.usage = (state.usage ?? []).filter((usage) => usage.scopeType === "ip" && usage.scopeId === digest);
    return shard;
  }
  const digest = key.slice(8);
  shard.creatorSessions = state.creatorSessions.filter((session) => session.tokenDigest === digest);
  const ownerIds = new Set(shard.creatorSessions.map((session) => session.id));
  shard.runs = state.runs.filter((run) => ownerIds.has(run.creatorSessionId));
  shard.memories = state.memories.filter((memory) => ownerIds.has(memory.creatorSessionId));
  shard.usage = (state.usage ?? []).filter((usage) => usage.scopeType === "session" && usage.scopeId === digest);
  return shard;
}

function isEmptyShard(state: AgentState): boolean {
  return state.creatorSessions.length === 0 && state.runs.length === 0 && state.memories.length === 0 && (state.usage?.length ?? 0) === 0;
}

async function deleteMissing(client: PoolClient, table: string, ownerColumn: string, ownerId: string, ids: string[]): Promise<void> {
  await client.query(`DELETE FROM ${table} WHERE ${ownerColumn} = $1 AND NOT (id = ANY($2::text[]))`, [ownerId, ids]);
}

async function syncSessionProjection(client: PoolClient, before: AgentState, after: AgentState, digest: string): Promise<void> {
  const previous = before.creatorSessions.find((session) => session.tokenDigest === digest);
  const session = after.creatorSessions.find((item) => item.tokenDigest === digest);
  if (!session) {
    if (previous) await client.query("DELETE FROM creator_session WHERE id = $1", [previous.id]);
    return;
  }
  await client.query(
    "INSERT INTO creator_session (id, token_digest, expires_at, last_seen_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET token_digest=EXCLUDED.token_digest, expires_at=EXCLUDED.expires_at, last_seen_at=EXCLUDED.last_seen_at, payload=EXCLUDED.payload",
    [session.id, session.tokenDigest, session.expiresAt, session.lastSeenAt, JSON.stringify(session)],
  );
  const runs = after.runs.filter((run) => run.creatorSessionId === session.id);
  for (const run of runs) {
    await client.query(
      "INSERT INTO agent_run (id, creator_session_id, revision, status, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET revision=EXCLUDED.revision, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload",
      [run.id, session.id, run.revision, run.status, run.updatedAt, JSON.stringify(run)],
    );
    for (const message of run.messages) await client.query(
      "INSERT INTO agent_message (id, run_id, role, created_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload",
      [message.id, run.id, message.role, message.createdAt, JSON.stringify(message)],
    );
    await deleteMissing(client, "agent_message", "run_id", run.id, run.messages.map((item) => item.id));
    for (const candidate of run.candidates) await client.query(
      "INSERT INTO agent_candidate (id, run_id, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload",
      [candidate.id, run.id, JSON.stringify(candidate)],
    );
    await deleteMissing(client, "agent_candidate", "run_id", run.id, run.candidates.map((item) => item.id));
    const calls = buildToolCallProjection(run);
    for (const call of calls) await client.query(
      "INSERT INTO agent_tool_call (id, run_id, tool, status, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tool=EXCLUDED.tool, status=EXCLUDED.status, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload",
      [call.id, run.id, call.tool, call.status, call.createdAt, JSON.stringify(call)],
    );
    await deleteMissing(client, "agent_tool_call", "run_id", run.id, calls.map((item) => item.id));
    for (const approval of run.approvals) await client.query(
      "INSERT INTO agent_approval (id, run_id, tool, status, requested_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tool=EXCLUDED.tool, status=EXCLUDED.status, requested_at=EXCLUDED.requested_at, payload=EXCLUDED.payload",
      [approval.id, run.id, approval.tool, approval.status, approval.requestedAt, JSON.stringify(approval)],
    );
    await deleteMissing(client, "agent_approval", "run_id", run.id, run.approvals.map((item) => item.id));
  }
  await deleteMissing(client, "agent_run", "creator_session_id", session.id, runs.map((run) => run.id));
  const memoryEntries = after.memories.find((memory) => memory.creatorSessionId === session.id)?.memory.entries ?? [];
  for (const entry of memoryEntries) await client.query(
    "INSERT INTO creator_memory (creator_session_id, memory_key, memory_value, confidence, payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (creator_session_id,memory_key,memory_value) DO UPDATE SET confidence=EXCLUDED.confidence, payload=EXCLUDED.payload",
    [session.id, entry.key, entry.value, entry.confidence, JSON.stringify(entry)],
  );
  await client.query(
    "DELETE FROM creator_memory WHERE creator_session_id = $1 AND NOT ((memory_key, memory_value) IN (SELECT * FROM unnest($2::text[], $3::text[])))",
    [session.id, memoryEntries.map((entry) => entry.key), memoryEntries.map((entry) => entry.value)],
  );
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
