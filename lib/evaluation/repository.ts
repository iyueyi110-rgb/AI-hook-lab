import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import { EVALUATION_CASES } from "./seeds.ts";
import { EVALUATION_SCHEMA_SQL } from "./schema.ts";
import type { EvaluationState, PromptVersion } from "./types.ts";

export interface EvaluationRepository {
  initialize(): Promise<void>;
  read(): Promise<EvaluationState>;
  transaction<T>(mutator: (state: EvaluationState) => T | Promise<T>): Promise<T>;
  readonly mode: "postgres" | "json";
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const BASELINE_PROMPT = `你是一名多平台内容编辑。根据固定主题、平台、目标用户和字数限制生成 3 条不同策略的 Hook。输出严格 JSON，包含 content、styleTag、recommendReason、modelScore。不得编造点击、收藏、采用或传播效果。`;
const CANDIDATE_PROMPT = `${BASELINE_PROMPT}\n开头前 15 字必须提供具体对象、反差、问题或明确收益；推荐理由必须引用 Hook 中的具体表达，并解释平台适配策略。`;

function promptVersion(version: string, role: "baseline" | "candidate", content: string, summary: string): PromptVersion {
  return {
    id: `prompt-${version}`,
    version,
    name: `${version} ${role}`,
    role,
    promptContent: content,
    changeSummary: summary,
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7, max_tokens: 2048, response_format: { type: "json_object" } },
    contentHash: contentHash(content),
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

export function createInitialEvaluationState(): EvaluationState {
  return {
    schemaVersion: 1,
    users: [],
    sessions: [],
    cases: structuredClone(EVALUATION_CASES),
    promptVersions: [
      promptVersion("v1.0", "baseline", BASELINE_PROMPT, "首个固定离线评测基线"),
      promptVersion("v1.1", "candidate", CANDIDATE_PROMPT, "强化前置信息与平台化推荐理由"),
    ],
    runs: [],
    auditLog: [],
  };
}

export class JsonEvaluationRepository implements EvaluationRepository {
  readonly mode = "json" as const;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath = path.join(process.cwd(), "data", "evaluation-store.json")) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await this.write(createInitialEvaluationState());
    }
  }

  async read(): Promise<EvaluationState> {
    await this.initialize();
    return JSON.parse(await readFile(this.filePath, "utf8")) as EvaluationState;
  }

  async transaction<T>(mutator: (state: EvaluationState) => T | Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.queue = this.queue.then(async () => {
      try {
        const state = await this.read();
        const value = await mutator(state);
        await this.write(state);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
    await this.queue;
    return result;
  }

  private async write(state: EvaluationState): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}

export class PostgresEvaluationRepository implements EvaluationRepository {
  readonly mode = "postgres" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(EVALUATION_SCHEMA_SQL);
    const state = createInitialEvaluationState();
    await this.pool.query(
      `INSERT INTO evaluation_state (id, schema_version, payload) VALUES ('default', $1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [state.schemaVersion, JSON.stringify(state)],
    );
    await this.transaction(() => undefined);
  }

  async read(): Promise<EvaluationState> {
    const result = await this.pool.query<{ payload: EvaluationState }>("SELECT payload FROM evaluation_state WHERE id = 'default'");
    if (!result.rows[0]) throw new Error("Evaluation store is not initialized");
    return result.rows[0].payload;
  }

  async transaction<T>(mutator: (state: EvaluationState) => T | Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ payload: EvaluationState }>("SELECT payload FROM evaluation_state WHERE id = 'default' FOR UPDATE");
      if (!result.rows[0]) throw new Error("Evaluation store is not initialized");
      const state = result.rows[0].payload;
      const value = await mutator(state);
      await client.query("UPDATE evaluation_state SET schema_version = $1, payload = $2::jsonb, updated_at = NOW() WHERE id = 'default'", [state.schemaVersion, JSON.stringify(state)]);
      await syncProjection(client, state);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class MemoryEvaluationRepository implements EvaluationRepository {
  readonly mode = "json" as const;
  private state = createInitialEvaluationState();

  async initialize(): Promise<void> {}

  async read(): Promise<EvaluationState> {
    return structuredClone(this.state);
  }

  async transaction<T>(mutator: (state: EvaluationState) => T | Promise<T>): Promise<T> {
    const draft = structuredClone(this.state);
    const result = await mutator(draft);
    this.state = draft;
    return result;
  }
}

async function replaceRows(client: PoolClient, table: string, rows: Array<{ query: string; values: unknown[] }>) {
  await client.query(`DELETE FROM ${table}`);
  for (const row of rows) await client.query(row.query, row.values);
}

async function syncProjection(client: PoolClient, state: EvaluationState): Promise<void> {
  await replaceRows(client, "evaluation_user", state.users.map((item) => ({
    query: "INSERT INTO evaluation_user (id, username, role, status, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, item.username, item.role, item.status, JSON.stringify(item)],
  })));
  await replaceRows(client, "evaluation_session", state.sessions.map((item) => ({
    query: "INSERT INTO evaluation_session (id, user_id, token_hash, expires_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, item.userId, item.tokenHash, item.expiresAt, JSON.stringify(item)],
  })));
  await replaceRows(client, "evaluation_case", state.cases.map((item) => ({
    query: "INSERT INTO evaluation_case (id, case_id, topic_id, platform, data_origin, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    values: [item.id, item.caseId, item.topicId, item.platform, item.dataOrigin, JSON.stringify(item)],
  })));
  await replaceRows(client, "prompt_version", state.promptVersions.map((item) => ({
    query: "INSERT INTO prompt_version (id, version, role, content_hash, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, item.version, item.role, item.contentHash, JSON.stringify(item)],
  })));
  await replaceRows(client, "evaluation_run", state.runs.map((item) => ({
    query: "INSERT INTO evaluation_run (id, status, execution_mode, data_origin, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, item.status, item.executionMode, item.dataOrigin, JSON.stringify(item)],
  })));
  await replaceRows(client, "evaluation_generation", state.runs.flatMap((run) => run.candidates.map((item) => ({
    query: "INSERT INTO evaluation_generation (id, run_id, case_id, prompt_role, status, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    values: [item.id, run.id, item.caseId, item.promptRole, item.generationStatus, JSON.stringify(item)],
  }))));
  await replaceRows(client, "human_evaluation", state.runs.flatMap((run) => run.rawReviews.map((item) => ({
    query: "INSERT INTO human_evaluation (id, run_id, evaluator_id, formal_result_id, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, run.id, item.evaluatorId, item.formalResultId, JSON.stringify(item)],
  }))));
  await replaceRows(client, "pairwise_evaluation", state.runs.flatMap((run) => run.rawPairwiseEvaluations.map((item) => ({
    query: "INSERT INTO pairwise_evaluation (id, run_id, evaluator_id, case_id, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, run.id, item.evaluatorId, item.caseId, JSON.stringify(item)],
  }))));
  await replaceRows(client, "bad_case", state.runs.flatMap((run) => run.badCases.map((item) => ({
    query: "INSERT INTO bad_case (id, run_id, formal_result_id, type, severity, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    values: [item.id, run.id, item.formalResultId, item.type, item.severity, JSON.stringify(item)],
  }))));
  await replaceRows(client, "evaluation_audit", state.auditLog.map((item) => ({
    query: "INSERT INTO evaluation_audit (id, action, actor_id, created_at, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
    values: [item.id, item.action, item.actorId ?? null, item.createdAt, JSON.stringify(item.payload ?? {})],
  })));
}

let singleton: EvaluationRepository | undefined;

export function getEvaluationRepository(): EvaluationRepository {
  if (!singleton) {
    singleton = process.env.DATABASE_URL
      ? new PostgresEvaluationRepository(process.env.DATABASE_URL)
      : new JsonEvaluationRepository(process.env.EVALUATION_STORE_PATH || undefined);
  }
  return singleton;
}
