import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import {
  DatabaseNotConfiguredError,
  getConfiguredDatabaseUrl,
  getPersistenceMode,
} from "../persistence.ts";
import { activePostgresTransactionClient } from "../postgresTransactionContext.ts";
import type {
  CreativeStrategyAssignment,
  StrategyScopePair,
  StrategyStoreState,
  StrategyVersion,
} from "./types.ts";

export const STRATEGY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS content_strategy_card (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS content_strategy_version (
  card_id TEXT NOT NULL REFERENCES content_strategy_card(id),
  version INTEGER NOT NULL CHECK (version > 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'pending_review',
    'approved_experiment',
    'active',
    'rejected',
    'archived'
  )),
  scope_pairs JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (card_id, version)
);
CREATE TABLE IF NOT EXISTS content_strategy_evidence (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('real_user', 'evaluation_set', 'simulation')),
  eligibility TEXT NOT NULL CHECK (eligibility IN (
    'draft_only',
    'review_support',
    'activation_eligible'
  )),
  collected_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);
CREATE TABLE IF NOT EXISTS content_strategy_review (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);
CREATE TABLE IF NOT EXISTS creative_strategy_assignment (
  run_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL,
  applied_guidance_hash TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  FOREIGN KEY (card_id, strategy_version)
    REFERENCES content_strategy_version(card_id, version)
);
CREATE INDEX IF NOT EXISTS content_strategy_version_active_idx
  ON content_strategy_version(status, expires_at, activated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS content_strategy_version_one_active_per_card
  ON content_strategy_version(card_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS content_strategy_version_scope_idx
  ON content_strategy_version USING GIN(scope_pairs);
CREATE INDEX IF NOT EXISTS content_strategy_evidence_version_idx
  ON content_strategy_evidence(card_id, strategy_version, collected_at DESC);
CREATE INDEX IF NOT EXISTS content_strategy_review_version_idx
  ON content_strategy_review(card_id, strategy_version, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_strategy_assignment_card_idx
  ON creative_strategy_assignment(card_id, strategy_version);
`;

export function createInitialStrategyState(): StrategyStoreState {
  return {
    schemaVersion: 1,
    cards: [],
    versions: [],
    evidence: [],
    reviews: [],
    assignments: [],
  };
}

export interface StrategyRepository {
  readonly mode: "json" | "postgres";
  initialize(): Promise<void>;
  read(): Promise<StrategyStoreState>;
  transaction<T>(mutator: (state: StrategyStoreState) => T | Promise<T>): Promise<T>;
  readActive?(
    scope: StrategyScopePair,
    now: Date,
  ): Promise<Array<{ version: StrategyVersion; evidenceUpdatedAt: string }>>;
  bindingTransaction?<T>(
    runId: string,
    cardId: string,
    version: number,
    mutator: (state: StrategyStoreState) => T | Promise<T>,
  ): Promise<T>;
}

const jsonQueues = new Map<string, Promise<unknown>>();

export class JsonStrategyRepository implements StrategyRepository {
  readonly mode = "json" as const;
  private readonly filePath: string;

  constructor(filePath = path.join(process.cwd(), "data", "content-strategies.json")) {
    this.filePath = path.resolve(filePath);
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await this.write(createInitialStrategyState());
    }
  }

  async read(): Promise<StrategyStoreState> {
    await this.initialize();
    const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StrategyStoreState>;
    if (parsed.schemaVersion !== 1) throw new Error("unsupported_strategy_schema");
    return {
      schemaVersion: 1,
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    };
  }

  async transaction<T>(mutator: (state: StrategyStoreState) => T | Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const previous = jsonQueues.get(this.filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const state = await this.read();
        const value = await mutator(state);
        await this.write(state);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    jsonQueues.set(this.filePath, next.catch(() => undefined));
    await result;
    return result;
  }

  private async write(state: StrategyStoreState): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}

async function rows<T>(client: PoolClient, table: string): Promise<T[]> {
  const result = await client.query<{ payload: T }>(`SELECT payload FROM ${table}`);
  return result.rows.map((row) => row.payload);
}

async function readPostgresState(client: PoolClient): Promise<StrategyStoreState> {
  return {
    schemaVersion: 1,
    cards: await rows(client, "content_strategy_card"),
    versions: await rows(client, "content_strategy_version"),
    evidence: await rows(client, "content_strategy_evidence"),
    reviews: await rows(client, "content_strategy_review"),
    assignments: await rows(client, "creative_strategy_assignment"),
  };
}

async function syncPostgresState(client: PoolClient, state: StrategyStoreState): Promise<void> {
  await client.query("DELETE FROM creative_strategy_assignment");
  await client.query("DELETE FROM content_strategy_review");
  await client.query("DELETE FROM content_strategy_evidence");
  await client.query("DELETE FROM content_strategy_version");
  await client.query("DELETE FROM content_strategy_card");
  for (const card of state.cards) {
    await client.query(
      "INSERT INTO content_strategy_card (id,current_version,created_by,created_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [card.id, card.currentVersion, card.createdBy, card.createdAt, card.updatedAt, JSON.stringify(card)],
    );
  }
  for (const version of state.versions) {
    await client.query(
      "INSERT INTO content_strategy_version (card_id,version,revision,status,scope_pairs,content_hash,activated_at,expires_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)",
      [version.cardId, version.version, version.revision, version.status, JSON.stringify(version.scopePairs), version.contentHash, version.activatedAt ?? null, version.expiresAt ?? null, version.updatedAt, JSON.stringify(version)],
    );
  }
  for (const evidence of state.evidence) {
    await client.query(
      "INSERT INTO content_strategy_evidence (id,card_id,strategy_version,origin,eligibility,collected_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [evidence.id, evidence.cardId, evidence.strategyVersion, evidence.origin, evidence.eligibility, evidence.collectedAt, JSON.stringify(evidence)],
    );
  }
  for (const review of state.reviews) {
    await client.query(
      "INSERT INTO content_strategy_review (id,card_id,strategy_version,action,actor_id,created_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [review.id, review.cardId, review.strategyVersion, review.action, review.actorId, review.createdAt, JSON.stringify(review)],
    );
  }
  for (const assignment of state.assignments) {
    await client.query(
      "INSERT INTO creative_strategy_assignment (run_id,card_id,strategy_version,applied_guidance_hash,bound_at,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [assignment.runId, assignment.cardId, assignment.strategyVersion, assignment.appliedGuidanceHash, assignment.boundAt, JSON.stringify(assignment)],
    );
  }
}

export class PostgresStrategyRepository implements StrategyRepository {
  readonly mode = "postgres" as const;
  private initialized?: Promise<void>;
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  initialize(): Promise<void> {
    this.initialized ??= this.pool.query(STRATEGY_SCHEMA_SQL).then(() => undefined);
    return this.initialized;
  }

  async read(): Promise<StrategyStoreState> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      return await readPostgresState(client);
    } finally {
      client.release();
    }
  }

  async readActive(
    scope: StrategyScopePair,
    now: Date,
  ): Promise<Array<{ version: StrategyVersion; evidenceUpdatedAt: string }>> {
    await this.initialize();
    const result = await this.pool.query<{
      payload: StrategyVersion;
      evidence_updated_at: Date | string;
    }>(
      `SELECT v.payload,
              COALESCE(MAX(e.collected_at), v.activated_at) AS evidence_updated_at
         FROM content_strategy_version v
         LEFT JOIN content_strategy_evidence e
           ON e.card_id = v.card_id
          AND e.strategy_version = v.version
        WHERE v.status = 'active'
          AND v.expires_at > $1
          AND v.scope_pairs @> $2::jsonb
        GROUP BY v.card_id, v.version, v.payload, v.activated_at
        ORDER BY evidence_updated_at DESC, v.activated_at DESC, v.card_id ASC
        LIMIT 5`,
      [now.toISOString(), JSON.stringify([scope])],
    );
    return result.rows.map((row) => ({
      version: row.payload,
      evidenceUpdatedAt: row.evidence_updated_at instanceof Date
        ? row.evidence_updated_at.toISOString()
        : new Date(row.evidence_updated_at).toISOString(),
    }));
  }

  async bindingTransaction<T>(
    runId: string,
    cardId: string,
    version: number,
    mutator: (state: StrategyStoreState) => T | Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const ambientClient = activePostgresTransactionClient();
    if (ambientClient) {
      return this.bindingWithClient(ambientClient, runId, cardId, version, mutator);
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.bindingWithClient(client, runId, cardId, version, mutator);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async bindingWithClient<T>(
    client: PoolClient,
    runId: string,
    cardId: string,
    version: number,
    mutator: (state: StrategyStoreState) => T | Promise<T>,
  ): Promise<T> {
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('content_strategy_governance'))");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`creative_strategy_assignment:${runId}`]);
    const versionResult = await client.query<{ payload: StrategyVersion }>(
      `SELECT payload
         FROM content_strategy_version
        WHERE card_id = $1 AND version = $2
        FOR SHARE`,
      [cardId, version],
    );
    const assignmentResult = await client.query<{ payload: CreativeStrategyAssignment }>(
      `SELECT payload
         FROM creative_strategy_assignment
        WHERE run_id = $1
        FOR UPDATE`,
      [runId],
    );
    const state = createInitialStrategyState();
    state.versions = versionResult.rows.map((row) => row.payload);
    state.assignments = assignmentResult.rows.map((row) => row.payload);
    const result = await mutator(state);
    const assignment = state.assignments.find((item) => item.runId === runId);
    if (assignment && assignmentResult.rows.length === 0) {
      await client.query(
        `INSERT INTO creative_strategy_assignment
           (run_id,card_id,strategy_version,applied_guidance_hash,bound_at,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          assignment.runId,
          assignment.cardId,
          assignment.strategyVersion,
          assignment.appliedGuidanceHash,
          assignment.boundAt,
          JSON.stringify(assignment),
        ],
      );
    }
    return result;
  }

  async transaction<T>(mutator: (state: StrategyStoreState) => T | Promise<T>): Promise<T> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('content_strategy_governance'))");
      const state = await readPostgresState(client);
      const result = await mutator(state);
      await syncPostgresState(client, state);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

let singleton: StrategyRepository | undefined;

export function getStrategyRepository(): StrategyRepository {
  if (singleton) return singleton;
  const mode = getPersistenceMode();
  if (mode === "unavailable") throw new DatabaseNotConfiguredError();
  const databaseUrl = getConfiguredDatabaseUrl();
  singleton = databaseUrl
    ? new PostgresStrategyRepository(new Pool({ connectionString: databaseUrl, max: 5 }))
    : new JsonStrategyRepository(process.env.STRATEGY_STORE_PATH || undefined);
  return singleton;
}
