import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

import { getConfiguredDatabaseUrl, getPersistenceMode } from "./persistence.ts";
import { readDashboardEvents, type DashboardEvent } from "./dashboardStore.ts";
import type { GenerateRequest, GenerateResponse, HookResult } from "./types.ts";

export type CandidateTaskStatus = "started" | "completed" | "failed";

export interface CandidateAnalyticsTask {
  taskId: string;
  platform: string;
  contentType: string;
  promptVersion: string;
  promptVariant: string;
  model: string;
  candidateCount: number;
  status: CandidateTaskStatus;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface CandidateAnalyticsCandidate {
  taskId: string;
  hookId: string;
  position: number;
  platform: string;
  contentType: string;
  promptVersion: string;
  promptVariant: string;
  model: string;
  clickScore: number;
  overallScore: number;
  badcaseTags: string[];
  createdAt: string;
}

export interface CandidateFunnelRow extends CandidateAnalyticsCandidate {
  taskStatus: CandidateTaskStatus;
  favorited: boolean;
  adopted: boolean;
  finalConfirmed: boolean;
  usageOutcome: string;
  dataOrigin: "real_user";
}

export interface CandidateAnalyticsSummary {
  dataOrigin: "real_user";
  totals: {
    tasks: number;
    completedTasks: number;
    candidates: number;
    favoritedCandidates: number;
    adoptedCandidates: number;
    finalConfirmedTasks: number;
  };
  rates: {
    completionRate: number;
    favoriteRate: number;
    adoptionRate: number;
    finalConfirmationRate: number;
  };
  byPlatform: Record<string, { tasks: number; candidates: number; favorites: number; finalConfirmedTasks: number }>;
  byPromptVersion: Record<string, { tasks: number; candidates: number; favorites: number; finalConfirmedTasks: number }>;
  byBadcaseType: Record<string, number>;
  limitation: string;
}

interface CandidateAnalyticsStore {
  tasks: CandidateAnalyticsTask[];
  candidates: CandidateAnalyticsCandidate[];
}

const DEFAULT_STORE_PATH = path.join(tmpdir(), "ai-hook-lab", "candidate-analytics.json");
const MAX_ID_LENGTH = 128;
const MAX_BADCASE_TAGS = 20;

let pool: Pool | undefined;
let poolUrl: string | undefined;
let storeQueue: Promise<void> = Promise.resolve();

function analyticsStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CANDIDATE_ANALYTICS_STORE_PATH?.trim() || DEFAULT_STORE_PATH;
}

function createId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAnalyticsTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID_LENGTH) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(trimmed) ? trimmed : undefined;
}

function safeId(value: unknown): string {
  return normalizeAnalyticsTaskId(value) ?? createId();
}

function safeText(value: unknown, fallback: string, maxLength = 100): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : fallback;
}

function safeScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score * 10) / 10)) : 0;
}

function safeBadcaseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim().slice(0, 64)))].slice(0, MAX_BADCASE_TAGS);
}

function taskFromInput(input: {
  taskId: string;
  request: GenerateRequest;
  response?: GenerateResponse;
  status: CandidateTaskStatus;
  startedAt: string;
  now: string;
}): CandidateAnalyticsTask {
  return {
    taskId: safeId(input.taskId),
    platform: safeText(input.request.platform, "unknown"),
    contentType: safeText(input.request.contentType, "unknown"),
    promptVersion: safeText(input.response?.templateVersion, "unknown"),
    promptVariant: safeText(input.response?.promptVariant ?? input.request.promptVariant, "unknown"),
    model: safeText(input.response?.model, "unknown"),
    candidateCount: input.response?.hooks.length ?? 0,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.status === "completed" ? input.now : undefined,
    updatedAt: input.now,
  };
}

function candidatesFromResponse(taskId: string, response: GenerateResponse, createdAt: string): CandidateAnalyticsCandidate[] {
  return response.hooks.map((hook: HookResult, index) => ({
    taskId: safeId(taskId),
    hookId: safeText(hook.id, `${safeId(taskId)}-${index + 1}`, MAX_ID_LENGTH),
    position: index + 1,
    platform: safeText(response.platform, "unknown"),
    contentType: safeText(response.contentType, "unknown"),
    promptVersion: safeText(response.templateVersion, "unknown"),
    promptVariant: safeText(response.promptVariant, "unknown"),
    model: safeText(response.model, "unknown"),
    clickScore: safeScore(hook.clickScore),
    overallScore: safeScore(hook.overallScore ?? hook.score),
    badcaseTags: safeBadcaseTags(hook.badcaseTags),
    createdAt,
  }));
}

async function readJsonStore(env: NodeJS.ProcessEnv = process.env): Promise<CandidateAnalyticsStore> {
  try {
    const parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ analyticsStorePath(env), "utf8"),
    ) as Partial<CandidateAnalyticsStore>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    };
  } catch {
    return { tasks: [], candidates: [] };
  }
}

async function writeJsonStore(store: CandidateAnalyticsStore, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const target = analyticsStorePath(env);
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ target, JSON.stringify(store, null, 2), "utf8");
}

async function withJsonMutation<T>(mutator: (store: CandidateAnalyticsStore) => T | Promise<T>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const run = storeQueue.then(async () => {
    const store = await readJsonStore(env);
    const result = await mutator(store);
    await writeJsonStore(store, env);
    return result;
  });
  storeQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function getPool(env: NodeJS.ProcessEnv = process.env): Promise<Pool | undefined> {
  const url = getConfiguredDatabaseUrl(env);
  if (!url) return undefined;
  if (!pool || poolUrl !== url) {
    await pool?.end().catch(() => undefined);
    pool = new Pool({ connectionString: url, max: 4 });
    poolUrl = url;
  }
  return pool;
}

export async function ensureCandidateAnalyticsStore(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const configuredPool = await getPool(env);
  if (!configuredPool) return;
  await configuredPool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_event (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      data_origin TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS dashboard_event_hook_task_idx
      ON dashboard_event ((payload->>'hookId'), (payload->>'taskId'), timestamp);
    CREATE TABLE IF NOT EXISTS hook_generation_task (
      task_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt_variant TEXT NOT NULL,
      model TEXT NOT NULL,
      candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
      status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hook_candidate (
      task_id TEXT NOT NULL REFERENCES hook_generation_task(task_id) ON DELETE CASCADE,
      hook_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position > 0),
      platform TEXT NOT NULL,
      content_type TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt_variant TEXT NOT NULL,
      model TEXT NOT NULL,
      click_score NUMERIC(5,1) NOT NULL DEFAULT 0,
      overall_score NUMERIC(5,1) NOT NULL DEFAULT 0,
      badcase_tags TEXT[] NOT NULL DEFAULT '{}',
      data_origin TEXT NOT NULL DEFAULT 'real_user' CHECK (data_origin = 'real_user'),
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (task_id, hook_id)
    );
    CREATE INDEX IF NOT EXISTS hook_candidate_platform_version_idx
      ON hook_candidate (platform, prompt_version, created_at);
    CREATE OR REPLACE VIEW hook_candidate_funnel AS
    SELECT
      c.task_id,
      c.hook_id,
      c.position,
      c.platform,
      c.content_type,
      c.prompt_version,
      c.prompt_variant,
      c.model,
      c.click_score,
      c.overall_score,
      c.badcase_tags,
      c.data_origin,
      t.status AS task_status,
      COALESCE((SELECT e.type = 'hook_favorited' FROM dashboard_event e WHERE e.data_origin = c.data_origin AND e.type IN ('hook_favorited', 'hook_unfavorited') AND e.payload->>'hookId' = c.hook_id AND e.payload->>'taskId' = c.task_id ORDER BY e.timestamp DESC LIMIT 1), FALSE) AS favorited,
      COALESCE((SELECT e.type = 'hook_adopted' FROM dashboard_event e WHERE e.data_origin = c.data_origin AND e.type IN ('hook_adopted', 'hook_unadopted') AND e.payload->>'hookId' = c.hook_id AND e.payload->>'taskId' = c.task_id ORDER BY e.timestamp DESC LIMIT 1), FALSE) AS adopted,
      COALESCE((SELECT e.payload->>'usageOutcome' FROM dashboard_event e WHERE e.data_origin = c.data_origin AND e.type = 'creator_feedback' AND e.payload->>'status' = 'submitted' AND e.payload->>'hookId' = c.hook_id AND e.payload->>'taskId' = c.task_id ORDER BY e.timestamp DESC LIMIT 1), '') AS usage_outcome,
      COALESCE((SELECT e.payload->>'usageOutcome' IN ('direct_use', 'light_edit', 'heavy_rewrite') FROM dashboard_event e WHERE e.data_origin = c.data_origin AND e.type = 'creator_feedback' AND e.payload->>'status' = 'submitted' AND e.payload->>'hookId' = c.hook_id AND e.payload->>'taskId' = c.task_id ORDER BY e.timestamp DESC LIMIT 1), FALSE) AS final_confirmed
    FROM hook_candidate c
    JOIN hook_generation_task t ON t.task_id = c.task_id;
  `);
}

async function withPgTransaction<T>(callback: (client: PoolClient) => Promise<T>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const configuredPool = await getPool(env);
  if (!configuredPool) throw new Error("PostgreSQL is not configured");
  const client = await configuredPool.connect();
  try {
    await client.query("BEGIN");
    await ensureCandidateAnalyticsStore(env);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function persistGenerationStart(input: {
  taskId: string;
  request: GenerateRequest;
  startedAt: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const now = new Date().toISOString();
  const task = taskFromInput({ ...input, status: "started", now });
  const configuredPool = await getPool(env);
  if (!configuredPool) {
    if (getPersistenceMode(env) === "unavailable") throw new Error("Production analytics database is not configured");
    await withJsonMutation((store) => {
      const existing = store.tasks.find((item) => item.taskId === task.taskId);
      if (existing) Object.assign(existing, task, { completedAt: existing.completedAt });
      else store.tasks.push(task);
    }, env);
    return;
  }
  await ensureCandidateAnalyticsStore(env);
  await configuredPool.query(
    `INSERT INTO hook_generation_task (task_id, platform, content_type, prompt_version, prompt_variant, model, candidate_count, status, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'started', $7, $8)
     ON CONFLICT (task_id) DO UPDATE SET platform = EXCLUDED.platform, content_type = EXCLUDED.content_type, prompt_variant = EXCLUDED.prompt_variant, status = 'started', updated_at = EXCLUDED.updated_at`,
    [task.taskId, task.platform, task.contentType, task.promptVersion, task.promptVariant, task.model, task.startedAt, now],
  );
}

export async function persistGenerationComplete(input: {
  taskId: string;
  request: GenerateRequest;
  response: GenerateResponse;
  startedAt: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const now = new Date().toISOString();
  const task = taskFromInput({ ...input, status: "completed", now });
  const candidates = candidatesFromResponse(input.taskId, input.response, now);
  const configuredPool = await getPool(env);
  if (!configuredPool) {
    if (getPersistenceMode(env) === "unavailable") throw new Error("Production analytics database is not configured");
    await withJsonMutation((store) => {
      const existing = store.tasks.find((item) => item.taskId === task.taskId);
      if (existing) Object.assign(existing, task);
      else store.tasks.push(task);
      store.candidates = [
        ...store.candidates.filter((item) => item.taskId !== task.taskId),
        ...candidates,
      ];
    }, env);
    return;
  }
  await withPgTransaction(async (client) => {
    await client.query(
      `INSERT INTO hook_generation_task (task_id, platform, content_type, prompt_version, prompt_variant, model, candidate_count, status, started_at, completed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $9)
       ON CONFLICT (task_id) DO UPDATE SET platform = EXCLUDED.platform, content_type = EXCLUDED.content_type, prompt_version = EXCLUDED.prompt_version, prompt_variant = EXCLUDED.prompt_variant, model = EXCLUDED.model, candidate_count = EXCLUDED.candidate_count, status = 'completed', completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at`,
      [task.taskId, task.platform, task.contentType, task.promptVersion, task.promptVariant, task.model, task.candidateCount, task.startedAt, now],
    );
    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO hook_candidate (task_id, hook_id, position, platform, content_type, prompt_version, prompt_variant, model, click_score, overall_score, badcase_tags, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (task_id, hook_id) DO UPDATE SET position = EXCLUDED.position, click_score = EXCLUDED.click_score, overall_score = EXCLUDED.overall_score, badcase_tags = EXCLUDED.badcase_tags`,
        [candidate.taskId, candidate.hookId, candidate.position, candidate.platform, candidate.contentType, candidate.promptVersion, candidate.promptVariant, candidate.model, candidate.clickScore, candidate.overallScore, candidate.badcaseTags, candidate.createdAt],
      );
    }
  }, env);
}

export async function persistGenerationFailure(input: {
  taskId: string;
  request: GenerateRequest;
  startedAt: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const now = new Date().toISOString();
  const task = taskFromInput({ ...input, status: "failed", now });
  const configuredPool = await getPool(env);
  if (!configuredPool) {
    if (getPersistenceMode(env) === "unavailable") return;
    await withJsonMutation((store) => {
      const existing = store.tasks.find((item) => item.taskId === task.taskId);
      if (existing) Object.assign(existing, task);
      else store.tasks.push(task);
    }, env);
    return;
  }
  await ensureCandidateAnalyticsStore(env);
  await configuredPool.query(
    `INSERT INTO hook_generation_task (task_id, platform, content_type, prompt_version, prompt_variant, model, candidate_count, status, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'failed', $7, $8)
     ON CONFLICT (task_id) DO UPDATE SET status = 'failed', updated_at = EXCLUDED.updated_at`,
    [task.taskId, task.platform, task.contentType, task.promptVersion, task.promptVariant, task.model, task.startedAt, now],
  );
}

function eventMatches(event: DashboardEvent, row: CandidateAnalyticsCandidate): boolean {
  return event.dataOrigin === "real_user" && event.payload?.hookId === row.hookId && event.payload?.taskId === row.taskId;
}

function applyEvents(row: CandidateAnalyticsCandidate, events: DashboardEvent[]): CandidateFunnelRow {
  const matched = events.filter((event) => eventMatches(event, row)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let favorited = false;
  let adopted = false;
  let usageOutcome = "";
  for (const event of matched) {
    if (event.type === "hook_favorited") favorited = true;
    if (event.type === "hook_unfavorited") favorited = false;
    if (event.type === "hook_adopted") adopted = true;
    if (event.type === "hook_unadopted") adopted = false;
    if (event.type === "creator_feedback" && event.payload?.status === "submitted") {
      usageOutcome = typeof event.payload.usageOutcome === "string" ? event.payload.usageOutcome : "";
    }
  }
  return {
    ...row,
    taskStatus: "completed",
    favorited,
    adopted,
    usageOutcome,
    finalConfirmed: ["direct_use", "light_edit", "heavy_rewrite"].includes(usageOutcome),
    dataOrigin: "real_user",
  };
}

export async function listCandidateFunnelRows(options: { env?: NodeJS.ProcessEnv; limit?: number } = {}): Promise<CandidateFunnelRow[]> {
  const env = options.env ?? process.env;
  const limit = Math.max(1, Math.min(options.limit ?? 5000, 50_000));
  const configuredPool = await getPool(env);
  if (configuredPool) {
    await ensureCandidateAnalyticsStore(env);
    const result = await configuredPool.query<CandidateFunnelRow>(
      `SELECT task_id AS "taskId", hook_id AS "hookId", position, platform, content_type AS "contentType", prompt_version AS "promptVersion", prompt_variant AS "promptVariant", model, click_score::float8 AS "clickScore", overall_score::float8 AS "overallScore", badcase_tags AS "badcaseTags", task_status AS "taskStatus", favorited, adopted, final_confirmed AS "finalConfirmed", usage_outcome AS "usageOutcome", data_origin AS "dataOrigin" FROM hook_candidate_funnel WHERE data_origin = 'real_user' ORDER BY task_id, position LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
  const store = await readJsonStore(env);
  const events = await readDashboardEvents();
  const taskStatus = new Map(store.tasks.map((task) => [task.taskId, task.status]));
  return store.candidates.slice(0, limit).map((row) => ({
    ...applyEvents(row, events),
    taskStatus: taskStatus.get(row.taskId) ?? "completed",
  }));
}

function increment(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

export function summarizeCandidateFunnel(rows: CandidateFunnelRow[]): CandidateAnalyticsSummary {
  const taskRows = new Map<string, CandidateFunnelRow[]>();
  for (const row of rows) taskRows.set(row.taskId, [...(taskRows.get(row.taskId) ?? []), row]);
  const completedTasks = [...taskRows.values()].filter((items) => items.some((item) => item.taskStatus === "completed"));
  const confirmedTasks = completedTasks.filter((items) => items.some((item) => item.finalConfirmed));
  const byPlatform: CandidateAnalyticsSummary["byPlatform"] = {};
  const byPromptVersion: CandidateAnalyticsSummary["byPromptVersion"] = {};
  const byBadcaseType: Record<string, number> = {};
  for (const [taskId, items] of taskRows) {
    const first = items[0];
    if (!first) continue;
    const platform = byPlatform[first.platform] ?? { tasks: 0, candidates: 0, favorites: 0, finalConfirmedTasks: 0 };
    platform.tasks += 1;
    platform.candidates += items.length;
    platform.favorites += items.filter((item) => item.favorited).length;
    if (items.some((item) => item.finalConfirmed)) platform.finalConfirmedTasks += 1;
    byPlatform[first.platform] = platform;
    const version = byPromptVersion[first.promptVersion] ?? { tasks: 0, candidates: 0, favorites: 0, finalConfirmedTasks: 0 };
    version.tasks += 1;
    version.candidates += items.length;
    version.favorites += items.filter((item) => item.favorited).length;
    if (items.some((item) => item.finalConfirmed)) version.finalConfirmedTasks += 1;
    byPromptVersion[first.promptVersion] = version;
    for (const tag of new Set(items.flatMap((item) => item.badcaseTags))) increment(byBadcaseType, tag);
    void taskId;
  }
  const candidates = rows.length;
  const favoritedCandidates = rows.filter((row) => row.favorited).length;
  return {
    dataOrigin: "real_user",
    totals: {
      tasks: taskRows.size,
      completedTasks: completedTasks.length,
      candidates,
      favoritedCandidates,
      adoptedCandidates: rows.filter((row) => row.adopted).length,
      finalConfirmedTasks: confirmedTasks.length,
    },
    rates: {
      completionRate: taskRows.size ? completedTasks.length / taskRows.size : 0,
      favoriteRate: candidates ? favoritedCandidates / candidates : 0,
      adoptionRate: candidates ? rows.filter((row) => row.adopted).length / candidates : 0,
      finalConfirmationRate: completedTasks.length ? confirmedTasks.length / completedTasks.length : 0,
    },
    byPlatform,
    byPromptVersion,
    byBadcaseType,
    limitation: "候选行共享同一任务上下文；平台和版本比较应同时报告任务数，不能把候选数当作独立用户样本。",
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function candidateRowsToCsv(rows: CandidateFunnelRow[]): string {
  const headers = ["task_id", "hook_id", "position", "platform", "content_type", "prompt_version", "prompt_variant", "model", "click_score", "overall_score", "favorited", "adopted", "final_confirmed", "usage_outcome", "bad_case_tags", "task_status", "data_origin"];
  const lines = rows.map((row) => [row.taskId, row.hookId, row.position, row.platform, row.contentType, row.promptVersion, row.promptVariant, row.model, row.clickScore, row.overallScore, row.favorited, row.adopted, row.finalConfirmed, row.usageOutcome, row.badcaseTags, row.taskStatus, row.dataOrigin].map(csvCell).join(","));
  return [headers.join(","), ...lines].join("\n") + "\n";
}
