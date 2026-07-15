import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { normalizeDataOrigin } from "./evaluation/origins.ts";
import type { DataOrigin } from "./evaluation/types.ts";

export type DashboardDataOrigin = DataOrigin;

export type DashboardEventType =
  | "generation_start"
  | "generation_complete"
  | "generation_error"
  | "hook_copied"
  | "hook_favorited"
  | "hook_unfavorited"
  | "hook_adopted"
  | "hook_unadopted"
  | "platform_satisfaction";

export interface DashboardEvent {
  id: string;
  type: DashboardEventType;
  timestamp: string;
  dataOrigin: DashboardDataOrigin;
  payload?: Record<string, unknown>;
}

export interface DashboardSummary {
  totals: {
    events: number;
    generationsStarted: number;
    generationsCompleted: number;
    generationsFailed: number;
    hooksGenerated: number;
    hooksCopied: number;
    hooksFavorited: number;
    hooksAdopted: number;
    satisfactionCount: number;
  };
  rates: {
    completionRate: number;
    favoriteRate: number;
    adoptionRate: number;
    copyRate: number;
  };
  averages: {
    avgScore: number;
    avgDurationMs: number;
    avgPlatformSatisfaction: number;
  };
  platformDistribution: Record<string, number>;
  promptVersionDistribution: Record<string, number>;
  dataOriginDistribution: Record<DashboardDataOrigin, number>;
  badcaseDistribution: Record<string, number>;
  platformMetrics: Record<
    string,
    {
      generations: number;
      hooksGenerated: number;
      avgClickScore: number;
      badcaseCount: number;
    }
  >;
  recentEvents: DashboardEvent[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const EVENTS_FILE = path.join(DATA_DIR, "dashboard-events.json");
const MAX_EVENTS = 5000;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }) : null;
const EVENT_TYPES = new Set<DashboardEventType>([
  "generation_start",
  "generation_complete",
  "generation_error",
  "hook_copied",
  "hook_favorited",
  "hook_unfavorited",
  "hook_adopted",
  "hook_unadopted",
  "platform_satisfaction",
]);

function createId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function isDashboardEventType(value: unknown): value is DashboardEventType {
  return typeof value === "string" && EVENT_TYPES.has(value as DashboardEventType);
}

function parseEvent(raw: unknown): DashboardEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isDashboardEventType(item.type)) return null;

  const payload =
    item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
      ? (item.payload as Record<string, unknown>)
      : undefined;

  try {
    return {
      id: String(item.id ?? createId()),
      type: item.type,
      timestamp: String(item.timestamp ?? new Date().toISOString()),
      dataOrigin: normalizeDataOrigin(item.dataOrigin),
      payload,
    };
  } catch {
    return null;
  }
}

export async function readDashboardEvents(): Promise<DashboardEvent[]> {
  if (pool) {
    await ensurePostgresStore();
    const result = await pool.query<DashboardEvent>(
      `SELECT id, type, timestamp::text, data_origin AS "dataOrigin", payload
       FROM dashboard_event ORDER BY timestamp DESC LIMIT $1`,
      [MAX_EVENTS]
    );
    return result.rows.reverse().map(parseEvent).filter((event): event is DashboardEvent => Boolean(event));
  }
  await ensureStore();
  try {
    const raw = await readFile(EVENTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseEvent).filter((event): event is DashboardEvent => Boolean(event));
  } catch {
    return [];
  }
}

export async function appendDashboardEvent(input: {
  type: unknown;
  timestamp?: unknown;
  payload?: unknown;
  dataOrigin?: unknown;
}): Promise<DashboardEvent> {
  if (!isDashboardEventType(input.type)) {
    throw new Error("Unsupported dashboard event type");
  }

  const event: DashboardEvent = {
    id: createId(),
    type: input.type,
    timestamp:
      typeof input.timestamp === "string" && input.timestamp
        ? input.timestamp
        : new Date().toISOString(),
    dataOrigin: normalizeDataOrigin(input.dataOrigin),
    payload:
      input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : undefined,
  };

  if (pool) {
    await ensurePostgresStore();
    await pool.query(
      `INSERT INTO dashboard_event (id, type, timestamp, data_origin, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [event.id, event.type, event.timestamp, event.dataOrigin, JSON.stringify(event.payload ?? {})]
    );
    return event;
  }

  const events = await readDashboardEvents();
  const next = [...events, event].slice(-MAX_EVENTS);
  await writeFile(EVENTS_FILE, JSON.stringify(next, null, 2), "utf8");
  return event;
}

async function ensurePostgresStore(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_event (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      data_origin TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS dashboard_event_timestamp_idx ON dashboard_event(timestamp);
    CREATE INDEX IF NOT EXISTS dashboard_event_origin_idx ON dashboard_event(data_origin, timestamp);
  `);
}

export function summarizeDashboardEvents(
  allEvents: DashboardEvent[],
  origin: DashboardDataOrigin = "real_user",
): DashboardSummary {
  const events = allEvents.filter((event) => event.dataOrigin === origin);
  const generationsStarted = events.filter((event) => event.type === "generation_start").length;
  const completed = events.filter((event) => event.type === "generation_complete");
  const generationsFailed = events.filter((event) => event.type === "generation_error").length;
  const copied = events.filter((event) => event.type === "hook_copied").length;
  const favs = events.filter((event) => event.type === "hook_favorited").length;
  const unfavs = events.filter((event) => event.type === "hook_unfavorited").length;
  const adopted = events.filter((event) => event.type === "hook_adopted").length;
  const unadopted = events.filter((event) => event.type === "hook_unadopted").length;
  const satisfactionEvents = events.filter((event) => event.type === "platform_satisfaction");

  const hooksGenerated = completed.reduce(
    (sum, event) => sum + (Number(event.payload?.hookCount) || 0),
    0
  );
  const scoreSum = completed.reduce(
    (sum, event) => sum + (Number(event.payload?.avgScore) || 0),
    0
  );
  const durationSum = completed.reduce(
    (sum, event) => sum + (Number(event.payload?.durationMs) || 0),
    0
  );
  const satisfactionSum = satisfactionEvents.reduce(
    (sum, event) => sum + (Number(event.payload?.rating) || 0),
    0
  );

  const platformDistribution: Record<string, number> = {};
  const promptVersionDistribution: Record<string, number> = {};
  const dataOriginDistribution: Record<DashboardDataOrigin, number> = {
    real_user: 0,
    evaluation_set: 0,
    simulation: 0,
  };
  const badcaseDistribution: Record<string, number> = {};
  const platformMetricDraft: Record<
    string,
    {
      generations: number;
      hooksGenerated: number;
      clickScoreSum: number;
      badcaseCount: number;
    }
  > = {};

  completed.forEach((event) => {
    const platform = String(event.payload?.platform ?? "unknown");
    const templateVersion = String(event.payload?.templateVersion ?? "unknown");
    const hookCount = Number(event.payload?.hookCount) || 0;
    const avgClickScore =
      Number(event.payload?.avgClickScore) || (Number(event.payload?.avgScore) || 0) * 10;
    const badcaseTags = event.payload?.badcaseTags;

    platformDistribution[platform] = (platformDistribution[platform] ?? 0) + 1;
    promptVersionDistribution[templateVersion] =
      (promptVersionDistribution[templateVersion] ?? 0) + 1;

    const draft =
      platformMetricDraft[platform] ??
      {
        generations: 0,
        hooksGenerated: 0,
        clickScoreSum: 0,
        badcaseCount: 0,
      };
    draft.generations += 1;
    draft.hooksGenerated += hookCount;
    draft.clickScoreSum += avgClickScore;

    if (Array.isArray(badcaseTags)) {
      badcaseTags.forEach((tag) => {
        const key = String(tag);
        badcaseDistribution[key] = (badcaseDistribution[key] ?? 0) + 1;
        draft.badcaseCount += 1;
      });
    }

    platformMetricDraft[platform] = draft;
  });

  allEvents.forEach((event) => {
    dataOriginDistribution[event.dataOrigin] += 1;
  });

  const platformMetrics = Object.fromEntries(
    Object.entries(platformMetricDraft).map(([platform, metric]) => [
      platform,
      {
        generations: metric.generations,
        hooksGenerated: metric.hooksGenerated,
        avgClickScore:
          metric.generations > 0 ? round(metric.clickScoreSum / metric.generations) : 0,
        badcaseCount: metric.badcaseCount,
      },
    ])
  );

  const hooksFavorited = Math.max(0, favs - unfavs);
  const hooksAdopted = Math.max(0, adopted - unadopted);

  return {
    totals: {
      events: events.length,
      generationsStarted,
      generationsCompleted: completed.length,
      generationsFailed,
      hooksGenerated,
      hooksCopied: copied,
      hooksFavorited,
      hooksAdopted,
      satisfactionCount: satisfactionEvents.length,
    },
    rates: {
      completionRate: rate(completed.length, generationsStarted),
      favoriteRate: rate(hooksFavorited, hooksGenerated),
      adoptionRate: rate(hooksAdopted, hooksGenerated),
      copyRate: rate(copied, hooksGenerated),
    },
    averages: {
      avgScore: completed.length > 0 ? round(scoreSum / completed.length) : 0,
      avgDurationMs: completed.length > 0 ? Math.round(durationSum / completed.length) : 0,
      avgPlatformSatisfaction:
        satisfactionEvents.length > 0 ? round(satisfactionSum / satisfactionEvents.length) : 0,
    },
    platformDistribution,
    promptVersionDistribution,
    dataOriginDistribution,
    badcaseDistribution,
    platformMetrics,
    recentEvents: events.slice(-20).reverse(),
  };
}

export async function getDashboardSummary(origin: DashboardDataOrigin = "real_user"): Promise<DashboardSummary> {
  const events = await readDashboardEvents();
  return summarizeDashboardEvents(events, origin);
}
