import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import { getConfiguredDatabaseUrl, getPersistenceMode } from "../persistence";
import type { OpsAgentSession } from "./ops-types";

const SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_OWNER_SESSIONS = 20;

export const OPS_AGENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ops_agent_session (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ops_agent_session_owner_updated_idx ON ops_agent_session(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ops_agent_session_expires_idx ON ops_agent_session(expires_at);
`;

export class OpsSessionConflictError extends Error {
  constructor(message = "会话已被其他请求更新") { super(message); this.name = "OpsSessionConflictError"; }
}

export interface OpsAgentRepository {
  initialize(): Promise<void>;
  create(ownerUserId: string, now?: Date): Promise<OpsAgentSession>;
  get(id: string, ownerUserId: string, now?: Date): Promise<OpsAgentSession | null>;
  save(session: OpsAgentSession, expectedRevision: number): Promise<OpsAgentSession>;
}

function newSession(ownerUserId: string, now: Date): OpsAgentSession {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(), ownerUserId, revision: 0, status: "idle", activeContext: {},
    messages: [], toolEvents: [], traces: [], createdAt: timestamp, updatedAt: timestamp,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
}

interface JsonState { sessions: OpsAgentSession[] }

export class JsonOpsAgentRepository implements OpsAgentRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;
  constructor(filePath = path.join(process.cwd(), "data", "ops-agent-store.json")) { this.filePath = path.resolve(filePath); }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try { await readFile(this.filePath, "utf8"); } catch { await this.write({ sessions: [] }); }
  }

  private async read(): Promise<JsonState> {
    await this.initialize();
    const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as JsonState;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  }

  private async write(state: JsonState): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }

  private transact<T>(operation: (state: JsonState) => Promise<T> | T): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    this.queue = this.queue.then(async () => {
      try {
        const state = await this.read();
        const value = await operation(state);
        await this.write(state);
        resolve(value);
      } catch (error) { reject(error); }
    });
    return result;
  }

  async create(ownerUserId: string, now = new Date()): Promise<OpsAgentSession> {
    return this.transact((state) => {
      const nowMs = now.getTime();
      state.sessions = state.sessions.filter((item) => Date.parse(item.expiresAt) > nowMs);
      const ownerSessions = state.sessions.filter((item) => item.ownerUserId === ownerUserId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const remove = new Set(ownerSessions.slice(MAX_OWNER_SESSIONS - 1).map((item) => item.id));
      state.sessions = state.sessions.filter((item) => !remove.has(item.id));
      const session = newSession(ownerUserId, now);
      state.sessions.push(session);
      return structuredClone(session);
    });
  }

  async get(id: string, ownerUserId: string, now = new Date()): Promise<OpsAgentSession | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const state = await this.read();
    const session = state.sessions.find((item) => item.id === id && item.ownerUserId === ownerUserId && Date.parse(item.expiresAt) > now.getTime());
    return session ? structuredClone(session) : null;
  }

  async save(session: OpsAgentSession, expectedRevision: number): Promise<OpsAgentSession> {
    return this.transact((state) => {
      const index = state.sessions.findIndex((item) => item.id === session.id && item.ownerUserId === session.ownerUserId);
      if (index < 0 || state.sessions[index]!.revision !== expectedRevision) throw new OpsSessionConflictError();
      const next = structuredClone(session);
      next.revision = expectedRevision + 1;
      state.sessions[index] = next;
      return structuredClone(next);
    });
  }
}

export class PostgresOpsAgentRepository implements OpsAgentRepository {
  private initialized?: Promise<void>;
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  initialize(): Promise<void> { this.initialized ??= this.pool.query(OPS_AGENT_SCHEMA_SQL).then(() => undefined); return this.initialized; }

  async create(ownerUserId: string, now = new Date()): Promise<OpsAgentSession> {
    await this.initialize();
    const session = newSession(ownerUserId, now);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM ops_agent_session WHERE expires_at <= NOW()");
      await client.query(`DELETE FROM ops_agent_session WHERE id IN (SELECT id FROM ops_agent_session WHERE owner_user_id=$1 ORDER BY updated_at DESC OFFSET $2)`, [ownerUserId, MAX_OWNER_SESSIONS - 1]);
      await client.query("INSERT INTO ops_agent_session (id, owner_user_id, revision, status, expires_at, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)", [session.id, ownerUserId, session.revision, session.status, session.expiresAt, session.updatedAt, JSON.stringify(session)]);
      await client.query("COMMIT");
      return session;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async get(id: string, ownerUserId: string, now = new Date()): Promise<OpsAgentSession | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    await this.initialize();
    const result = await this.pool.query<{ payload: OpsAgentSession }>("SELECT payload FROM ops_agent_session WHERE id=$1 AND owner_user_id=$2 AND expires_at>$3", [id, ownerUserId, now.toISOString()]);
    return result.rows[0]?.payload ?? null;
  }

  async save(session: OpsAgentSession, expectedRevision: number): Promise<OpsAgentSession> {
    await this.initialize();
    const next = structuredClone(session);
    next.revision = expectedRevision + 1;
    const result = await this.pool.query("UPDATE ops_agent_session SET revision=$1,status=$2,expires_at=$3,updated_at=$4,payload=$5::jsonb WHERE id=$6 AND owner_user_id=$7 AND revision=$8", [next.revision, next.status, next.expiresAt, next.updatedAt, JSON.stringify(next), next.id, next.ownerUserId, expectedRevision]);
    if (result.rowCount !== 1) throw new OpsSessionConflictError();
    return next;
  }
}

let repository: OpsAgentRepository | undefined;
export function getOpsAgentRepository(): OpsAgentRepository {
  if (repository) return repository;
  const mode = getPersistenceMode();
  if (mode === "unavailable") throw new Error("生产环境数据库未配置");
  const databaseUrl = getConfiguredDatabaseUrl();
  repository = databaseUrl ? new PostgresOpsAgentRepository(new Pool({ connectionString: databaseUrl, max: 3 })) : new JsonOpsAgentRepository();
  return repository;
}
