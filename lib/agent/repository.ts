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
}

export interface AgentRepository {
  initialize(): Promise<void>;
  read(): Promise<AgentState>;
  transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T>;
  readonly mode: "postgres" | "json";
}

export class AgentNotFoundError extends Error {
  readonly code = "agent_not_found" as const;
  constructor() {
    super("Agent run was not found");
    this.name = "AgentNotFoundError";
  }
}

export function createInitialAgentState(): AgentState {
  return { schemaVersion: 1, creatorSessions: [], runs: [], memories: [] };
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

export function listCreatorMemory(state: AgentState, creatorSessionId: string): Memory {
  return state.memories.find((item) => item.creatorSessionId === creatorSessionId)?.memory ?? { entries: [] };
}

export function recordCreatorMemory(state: AgentState, creatorSessionId: string, update: { key: MemoryKey; value: string }): { memory: Memory; accepted: boolean } {
  const current = listCreatorMemory(state, creatorSessionId);
  const result = recordMemory({ id: "memory", revision: 0, status: "understanding", messages: [], candidates: [], toolCalls: [], toolResults: [], approvals: [], memory: current, revisionRounds: 0 }, 0, update);
  if (result.accepted) {
    const existing = state.memories.find((item) => item.creatorSessionId === creatorSessionId);
    if (existing) existing.memory = result.run.memory;
    else state.memories.push({ creatorSessionId, memory: result.run.memory });
  }
  return { memory: result.run.memory, accepted: result.accepted };
}

export function deleteCreatorMemory(state: AgentState, creatorSessionId: string, key?: MemoryKey, value?: string): void {
  const entry = state.memories.find((item) => item.creatorSessionId === creatorSessionId);
  if (!entry) return;
  if (!key) { entry.memory = { entries: [] }; return; }
  entry.memory = { entries: entry.memory.entries.filter((item) => item.key !== key || (value !== undefined && item.value !== value)) };
}

export function cleanupStaleRuns(state: AgentState, now = new Date()): string[] {
  const threshold = now.getTime() - STALE_RUN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const removable = new Set(state.runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status) && Date.parse(run.updatedAt) < threshold).map((run) => run.id));
  state.runs = state.runs.filter((run) => !removable.has(run.id));
  return [...removable];
}

function summaryFor(run: StoredAgentRun, originalMessageCount = run.messages.length): AgentRunSummary {
  return { messageCount: Math.max(run.summary?.messageCount ?? 0, originalMessageCount), latestMessageAt: run.messages.at(-1)?.createdAt ?? run.summary?.latestMessageAt, candidateCount: run.candidates.length, status: run.status };
}

function stripImagePayload(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("data:image/") ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => stripImagePayload(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const normalizedKey = childKey.toLowerCase();
    const isDescription = normalizedKey === "imagedescription";
    if (!isDescription && (normalizedKey.includes("image") || normalizedKey.includes("base64") || normalizedKey.includes("binary"))) continue;
    const child = stripImagePayload(childValue);
    if (child !== undefined) clean[childKey] = child;
  }
  return clean;
}

function normalizeState(state: AgentState): void {
  state.schemaVersion = 1;
  state.runs = state.runs.map((run) => {
    const originalMessageCount = run.messages.length;
    const messages = trimRecentMessages(run.messages);
    const trimmed = { ...run, messages };
    const safeRun = stripImagePayload(trimmed) as StoredAgentRun;
    return { ...safeRun, summary: summaryFor(safeRun, originalMessageCount) };
  });
}

export class MemoryAgentRepository implements AgentRepository {
  readonly mode = "json" as const;
  private state = createInitialAgentState();
  async initialize(): Promise<void> {}
  async read(): Promise<AgentState> { return structuredClone(this.state); }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const result = await mutator(draft);
    normalizeState(draft);
    this.state = draft;
    return result;
  }
}

export class JsonAgentRepository implements AgentRepository {
  readonly mode = "json" as const;
  private queue: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  constructor(filePath = path.join(process.cwd(), "data", "agent-store.json")) { this.filePath = filePath; }
  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try { await readFile(this.filePath, "utf8"); } catch { await this.write(createInitialAgentState()); }
  }
  async read(): Promise<AgentState> {
    await this.initialize();
    return JSON.parse(await readFile(this.filePath, "utf8")) as AgentState;
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    this.queue = this.queue.then(async () => {
      try { const state = await this.read(); const value = await mutator(state); normalizeState(state); await this.write(state); resolve(value); }
      catch (error) { reject(error); }
    });
    await this.queue;
    return result;
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
    const result = await this.pool.query<{ payload: AgentState }>("SELECT payload FROM agent_state WHERE id = 'default'");
    if (!result.rows[0]) throw new Error("Agent store is not initialized");
    return result.rows[0].payload;
  }
  async transaction<T>(mutator: (state: AgentState) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ payload: AgentState }>("SELECT payload FROM agent_state WHERE id = 'default' FOR UPDATE");
      if (!result.rows[0]) throw new Error("Agent store is not initialized");
      const state = result.rows[0].payload;
      const value = await mutator(state);
      normalizeState(state);
      await client.query("UPDATE agent_state SET schema_version = $1, payload = $2::jsonb, updated_at = NOW() WHERE id = 'default'", [state.schemaVersion, JSON.stringify(state)]);
      await syncProjection(client, state);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
  await replaceRows(client, "agent_tool_call", state.runs.flatMap((run) => run.toolCalls.map((item) => ({ query: "INSERT INTO agent_tool_call (id, run_id, tool, status, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", values: [item.id, run.id, item.tool, item.status, item.createdAt, JSON.stringify(item)] }))));
  await replaceRows(client, "agent_approval", state.runs.flatMap((run) => run.approvals.map((item) => ({ query: "INSERT INTO agent_approval (id, run_id, tool, status, requested_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)", values: [item.id, run.id, item.tool, item.status, item.requestedAt, JSON.stringify(item)] }))));
  await replaceRows(client, "creator_memory", state.memories.flatMap((owner) => owner.memory.entries.map((item) => ({ query: "INSERT INTO creator_memory (creator_session_id, memory_key, memory_value, confidence, payload) VALUES ($1,$2,$3,$4,$5::jsonb)", values: [owner.creatorSessionId, item.key, item.value, item.confidence, JSON.stringify(item)] }))));
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
