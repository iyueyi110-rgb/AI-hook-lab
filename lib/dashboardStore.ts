import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { CONTENT_TYPE_CONFIG, PLATFORM_CONFIG } from "./constants";
import { normalizeDataOrigin } from "./evaluation/origins";
import type { DataOrigin } from "./evaluation/types";
import { findSensitiveInputHints } from "./promptTemplates";
import {
  assertProductionDatabaseConfigured,
  getConfiguredDatabaseUrl,
} from "./persistence";

export type DashboardDataOrigin = DataOrigin;

export interface DashboardFeedbackFilters {
  platform?: string;
  promptVersion?: string;
  trigger?: string;
}

export type DashboardEventType =
  | "generation_start"
  | "generation_complete"
  | "generation_error"
  | "hook_copied"
  | "hook_favorited"
  | "hook_unfavorited"
  | "hook_adopted"
  | "hook_unadopted"
  | "platform_satisfaction"
  | "creator_feedback";

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
  feedback: {
    totals: {
      promptsShown: number;
      submitted: number;
      skipped: number;
      linkedCompletedTasks: number;
      totalCompletedTasks: number;
      tasksWithConfirmedUsage: number;
    };
    responseRate: number;
    taskCoverageRate: number;
    taskAdoptionRate: number;
    usageOutcomeDistribution: Record<string, number>;
    reasonDistribution: Record<string, number>;
    triggerDistribution: Record<string, number>;
    platformDistribution: Record<string, number>;
    promptVersionDistribution: Record<string, number>;
    modelHumanAlignment: Record<
      string,
      { agreed: number; missedByModel: number; modelOnly: number }
    >;
  };
  recentEvents: DashboardEvent[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const EVENTS_FILE = path.join(DATA_DIR, "dashboard-events.json");
const MAX_EVENTS = 5000;
const databaseUrl = getConfiguredDatabaseUrl();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3 }) : null;
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
  "creator_feedback",
]);
const PLATFORMS = new Set(Object.keys(PLATFORM_CONFIG));
const CONTENT_TYPES = new Set(Object.keys(CONTENT_TYPE_CONFIG));
const PROMPT_VARIANTS = new Set(["baseline", "candidate"]);
const BADCASE_TAGS = new Set([
  "too_long",
  "too_short",
  "clickbait_risk",
  "too_generic",
  "weak_reasoning",
  "platform_mismatch",
]);
const GENERATION_ERROR_CATEGORIES = new Set([
  "API Key 未配置",
  "请求格式错误",
  "主题为空",
  "主题过长",
  "目标用户描述过长",
  "输入包含疑似个人信息",
  "平台不支持",
  "内容类型不支持",
  "API Key 无效",
  "请求太频繁",
  "AI 服务异常",
  "AI 返回为空",
  "JSON 解析失败",
  "请求超时",
  "生成失败",
  "网络错误",
]);
const MAX_ANALYTICS_STRING_LENGTH = 100;
const MAX_HOOK_ID_LENGTH = 128;
const MAX_TOPIC_ID = 1_000_000;
const MAX_HOOK_COUNT = 100;
const MAX_GENERATION_DURATION_MS = 600_000;
const MAX_BADCASE_TAGS = 60;
const MAX_FEEDBACK_REASON_TAGS = 3;
const FEEDBACK_STATUSES = new Set(["shown", "submitted", "skipped"]);
const FEEDBACK_TRIGGERS = new Set([
  "adoption",
  "explicit_batch_reject",
  "sampled_before_regenerate",
  "low_satisfaction",
]);
const FEEDBACK_SCOPES = new Set(["hook", "batch"]);
const FEEDBACK_USAGE_OUTCOMES = new Set([
  "direct_use",
  "light_edit",
  "heavy_rewrite",
  "reference_only",
]);
const FEEDBACK_REASON_TAGS = new Set([
  "not_relevant",
  "too_generic",
  "platform_mismatch",
  "tone_mismatch",
  "length_mismatch",
  "weak_reasoning",
  "clickbait_risk",
  "repetitive",
  "hard_to_execute",
  "other",
]);
const COMPARABLE_FEEDBACK_TAGS = [
  "weak_reasoning",
  "clickbait_risk",
  "too_generic",
  "platform_mismatch",
] as const;

interface PayloadFieldRule {
  persist?: boolean;
  validate(value: unknown, field: string): unknown;
}

interface EventPayloadSchema {
  fields: Record<string, PayloadFieldRule>;
  required: readonly string[];
}

function invalidPayload(field: string): never {
  throw new Error(`Invalid dashboard event payload field: ${field}`);
}

function enumRule(values: ReadonlySet<string>): PayloadFieldRule {
  return {
    validate(value, field) {
      if (typeof value !== "string" || !values.has(value)) invalidPayload(field);
      return value;
    },
  };
}

function stringRule(maxLength: number, persist = true): PayloadFieldRule {
  return {
    persist,
    validate(value, field) {
      if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
        invalidPayload(field);
      }
      return value;
    },
  };
}

function numberRule(min: number, max: number, integer = false): PayloadFieldRule {
  return {
    validate(value, field) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isInteger(value))
      ) {
        invalidPayload(field);
      }
      return value;
    },
  };
}

const platformRule = enumRule(PLATFORMS);
const contentTypeRule = enumRule(CONTENT_TYPES);
const promptVariantRule = enumRule(PROMPT_VARIANTS);
const analyticsStringRule = stringRule(MAX_ANALYTICS_STRING_LENGTH);
const hookIdRule = stringRule(MAX_HOOK_ID_LENGTH);
const browserContextRule = stringRule(MAX_HOOK_ID_LENGTH);
const clickScoreRule = numberRule(0, 100);
const browserContextFields: Record<string, PayloadFieldRule> = {
  anonymousCreatorId: browserContextRule,
  taskId: browserContextRule,
};
const interactionContextFields: Record<string, PayloadFieldRule> = {
  platform: platformRule,
  contentType: contentTypeRule,
  templateVersion: analyticsStringRule,
  promptVariant: promptVariantRule,
  clickScore: clickScoreRule,
};
const interactionFields: Record<string, PayloadFieldRule> = {
  hookId: hookIdRule,
  ...browserContextFields,
  ...interactionContextFields,
};
const badcaseTagsRule: PayloadFieldRule = {
  validate(value, field) {
    if (
      !Array.isArray(value) ||
      value.length > MAX_BADCASE_TAGS ||
      value.some((tag) => typeof tag !== "string" || !BADCASE_TAGS.has(tag))
    ) {
      invalidPayload(field);
    }
    return [...value];
  },
};
const feedbackReasonTagsRule: PayloadFieldRule = {
  validate(value, field) {
    if (
      !Array.isArray(value) ||
      value.length > MAX_FEEDBACK_REASON_TAGS ||
      value.some((tag) => typeof tag !== "string" || !FEEDBACK_REASON_TAGS.has(tag))
    ) {
      invalidPayload(field);
    }
    return [...value];
  },
};
const feedbackCommentRule: PayloadFieldRule = {
  validate(value, field) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (
      typeof value !== "string" ||
      trimmed.length === 0 ||
      trimmed.length > MAX_ANALYTICS_STRING_LENGTH ||
      findSensitiveInputHints(trimmed).length > 0
    ) {
      invalidPayload(field);
    }
    return trimmed;
  },
};
const generationErrorRule = enumRule(GENERATION_ERROR_CATEGORIES);
const compatibilityTopicIdRule: PayloadFieldRule = {
  persist: false,
  validate(value, field) {
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_HOOK_ID_LENGTH) {
      return value;
    }
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_TOPIC_ID
    ) {
      return value;
    }
    invalidPayload(field);
  },
};

const EVENT_PAYLOAD_SCHEMAS: Record<DashboardEventType, EventPayloadSchema> = {
  generation_start: {
    fields: {
      ...browserContextFields,
      platform: platformRule,
      contentType: contentTypeRule,
      promptVariant: promptVariantRule,
      topicId: compatibilityTopicIdRule,
    },
    required: ["platform"],
  },
  generation_complete: {
    fields: {
      ...browserContextFields,
      platform: platformRule,
      contentType: contentTypeRule,
      model: analyticsStringRule,
      templateVersion: analyticsStringRule,
      promptVariant: promptVariantRule,
      hookCount: numberRule(0, MAX_HOOK_COUNT, true),
      avgScore: numberRule(0, 10),
      avgClickScore: clickScoreRule,
      durationMs: numberRule(0, MAX_GENERATION_DURATION_MS),
      badcaseTags: badcaseTagsRule,
    },
    required: ["platform", "hookCount"],
  },
  generation_error: {
    fields: { ...browserContextFields, error: generationErrorRule },
    required: ["error"],
  },
  hook_copied: {
    fields: { ...interactionFields, style: analyticsStringRule },
    required: ["hookId"],
  },
  hook_favorited: { fields: interactionFields, required: ["hookId"] },
  hook_unfavorited: { fields: interactionFields, required: ["hookId"] },
  hook_adopted: { fields: interactionFields, required: ["hookId"] },
  hook_unadopted: { fields: interactionFields, required: ["hookId"] },
  platform_satisfaction: {
    fields: {
      ...interactionFields,
      rating: numberRule(1, 5, true),
    },
    required: ["hookId", "rating"],
  },
  creator_feedback: {
    fields: {
      promptId: browserContextRule,
      status: enumRule(FEEDBACK_STATUSES),
      trigger: enumRule(FEEDBACK_TRIGGERS),
      scope: enumRule(FEEDBACK_SCOPES),
      anonymousCreatorId: browserContextRule,
      taskId: browserContextRule,
      hookId: hookIdRule,
      usageOutcome: enumRule(FEEDBACK_USAGE_OUTCOMES),
      reasonTags: feedbackReasonTagsRule,
      comment: feedbackCommentRule,
      ...interactionContextFields,
      modelBadcaseTags: badcaseTagsRule,
    },
    required: ["promptId", "status", "trigger", "scope", "anonymousCreatorId", "taskId"],
  },
};

function validateCreatorFeedbackConditions(payload: Record<string, unknown>): void {
  const status = payload.status;
  const trigger = payload.trigger;
  const scope = payload.scope;
  const reasonTags = payload.reasonTags;
  const hasReasons = Array.isArray(reasonTags) && reasonTags.length > 0;
  const hasResponse =
    payload.usageOutcome !== undefined || payload.reasonTags !== undefined || payload.comment !== undefined;

  if (scope === "hook" && typeof payload.hookId !== "string") invalidPayload("hookId");
  if (scope === "batch" && payload.hookId !== undefined) invalidPayload("hookId");
  if ((trigger === "adoption" || trigger === "low_satisfaction") && scope !== "hook") {
    invalidPayload("scope");
  }
  if (
    (trigger === "explicit_batch_reject" || trigger === "sampled_before_regenerate") &&
    scope !== "batch"
  ) {
    invalidPayload("scope");
  }

  if (status !== "submitted") {
    if (hasResponse) invalidPayload("status");
    return;
  }

  if (trigger === "adoption") {
    if (payload.usageOutcome === undefined) invalidPayload("usageOutcome");
    if (payload.usageOutcome === "direct_use") {
      if (payload.reasonTags !== undefined || payload.comment !== undefined) {
        invalidPayload("reasonTags");
      }
      return;
    }
    if (!hasReasons) invalidPayload("reasonTags");
    return;
  }

  if (payload.usageOutcome !== undefined) invalidPayload("usageOutcome");
  if (!hasReasons) invalidPayload("reasonTags");
}

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

function validateDashboardPayload(
  eventType: DashboardEventType,
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalidPayload("payload");

  const schema = EVENT_PAYLOAD_SCHEMAS[eventType];
  const input = raw as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(input)) {
    const rule = schema.fields[field];
    if (!rule) invalidPayload(field);
    if (value === undefined) continue;
    const validated = rule.validate(value, field);
    if (rule.persist !== false) payload[field] = validated;
  }

  for (const field of schema.required) {
    if (!Object.hasOwn(input, field) || input[field] === undefined) invalidPayload(field);
  }

  if (eventType === "creator_feedback") validateCreatorFeedbackConditions(payload);

  return payload;
}

function parseEvent(raw: unknown): DashboardEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isDashboardEventType(item.type)) return null;

  try {
    const payload = validateDashboardPayload(item.type, item.payload);
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
  assertProductionDatabaseConfigured();
  if (pool) {
    await ensurePostgresStore();
    const result = await pool.query<DashboardEvent>(
      `SELECT id, type, timestamp::text, data_origin AS "dataOrigin", payload
       FROM dashboard_event ORDER BY timestamp DESC LIMIT $1`,
      [MAX_EVENTS]
    );
    return result.rows
      .reverse()
      .map(parseEvent)
      .filter((event: DashboardEvent | null): event is DashboardEvent => Boolean(event));
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
  const dataOrigin = normalizeDataOrigin(input.dataOrigin);
  const payload = validateDashboardPayload(input.type, input.payload);
  assertProductionDatabaseConfigured();

  const event: DashboardEvent = {
    id: createId(),
    type: input.type,
    timestamp:
      typeof input.timestamp === "string" && input.timestamp
        ? input.timestamp
        : new Date().toISOString(),
    dataOrigin,
    payload,
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
  feedbackFilters: DashboardFeedbackFilters = {},
): DashboardSummary {
  const events = allEvents.filter((event) => {
    if (event.dataOrigin !== origin) return false;
    if (feedbackFilters.platform && event.payload?.platform !== feedbackFilters.platform) return false;
    if (
      feedbackFilters.promptVersion &&
      event.payload?.templateVersion !== feedbackFilters.promptVersion
    ) {
      return false;
    }
    if (
      feedbackFilters.trigger &&
      event.type === "creator_feedback" &&
      event.payload?.trigger !== feedbackFilters.trigger
    ) {
      return false;
    }
    return true;
  });
  const generationsStarted = events.filter((event) => event.type === "generation_start").length;
  const completed = events.filter((event) => event.type === "generation_complete");
  const generationsFailed = events.filter((event) => event.type === "generation_error").length;
  const copied = events.filter((event) => event.type === "hook_copied").length;
  const favs = events.filter((event) => event.type === "hook_favorited").length;
  const unfavs = events.filter((event) => event.type === "hook_unfavorited").length;
  const adopted = events.filter((event) => event.type === "hook_adopted").length;
  const unadopted = events.filter((event) => event.type === "hook_unadopted").length;
  const satisfactionEvents = events.filter((event) => event.type === "platform_satisfaction");
  const feedbackEvents = events.filter((event) => event.type === "creator_feedback");
  const submittedFeedback = feedbackEvents.filter((event) => event.payload?.status === "submitted");

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

  const shownPromptIds = new Set(
    feedbackEvents
      .filter((event) => event.payload?.status === "shown")
      .map((event) => String(event.payload?.promptId)),
  );
  const submittedPromptIds = new Set(
    submittedFeedback.map((event) => String(event.payload?.promptId)),
  );
  const linkedSubmittedPromptCount = [...submittedPromptIds].filter((promptId) =>
    shownPromptIds.has(promptId),
  ).length;
  const skippedPromptIds = new Set(
    feedbackEvents
      .filter((event) => event.payload?.status === "skipped")
      .map((event) => String(event.payload?.promptId)),
  );
  const completedTaskIds = new Set(
    completed
      .map((event) => event.payload?.taskId)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  );
  const confirmedUsageTaskIds = new Set(
    submittedFeedback
      .filter(
        (event) =>
          event.payload?.trigger === "adoption" &&
          ["direct_use", "light_edit", "heavy_rewrite"].includes(
            String(event.payload?.usageOutcome),
          ),
      )
      .map((event) => event.payload?.taskId)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  );
  const usageOutcomeDistribution: Record<string, number> = {};
  const reasonDistribution: Record<string, number> = {};
  const feedbackTriggerDistribution: Record<string, number> = {};
  const feedbackPlatformDistribution: Record<string, number> = {};
  const feedbackPromptVersionDistribution: Record<string, number> = {};
  const modelHumanAlignment = Object.fromEntries(
    COMPARABLE_FEEDBACK_TAGS.map((tag) => [
      tag,
      { agreed: 0, missedByModel: 0, modelOnly: 0 },
    ]),
  ) as DashboardSummary["feedback"]["modelHumanAlignment"];

  submittedFeedback.forEach((event) => {
    const usageOutcome = event.payload?.usageOutcome;
    if (typeof usageOutcome === "string") {
      usageOutcomeDistribution[usageOutcome] = (usageOutcomeDistribution[usageOutcome] ?? 0) + 1;
    }
    const trigger = String(event.payload?.trigger ?? "unknown");
    feedbackTriggerDistribution[trigger] = (feedbackTriggerDistribution[trigger] ?? 0) + 1;
    const platform = event.payload?.platform;
    if (typeof platform === "string") {
      feedbackPlatformDistribution[platform] = (feedbackPlatformDistribution[platform] ?? 0) + 1;
    }
    const promptVersion = event.payload?.templateVersion;
    if (typeof promptVersion === "string") {
      feedbackPromptVersionDistribution[promptVersion] =
        (feedbackPromptVersionDistribution[promptVersion] ?? 0) + 1;
    }

    const humanTags = new Set(
      Array.isArray(event.payload?.reasonTags)
        ? event.payload.reasonTags.filter((tag): tag is string => typeof tag === "string")
        : [],
    );
    const modelTags = new Set(
      Array.isArray(event.payload?.modelBadcaseTags)
        ? event.payload.modelBadcaseTags.filter((tag): tag is string => typeof tag === "string")
        : [],
    );
    humanTags.forEach((tag) => {
      reasonDistribution[tag] = (reasonDistribution[tag] ?? 0) + 1;
    });
    COMPARABLE_FEEDBACK_TAGS.forEach((tag) => {
      const human = humanTags.has(tag);
      const model = modelTags.has(tag);
      if (human && model) modelHumanAlignment[tag].agreed += 1;
      else if (human) modelHumanAlignment[tag].missedByModel += 1;
      else if (model) modelHumanAlignment[tag].modelOnly += 1;
    });
  });

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
    feedback: {
      totals: {
        promptsShown: shownPromptIds.size,
        submitted: submittedPromptIds.size,
        skipped: skippedPromptIds.size,
        linkedCompletedTasks: completedTaskIds.size,
        totalCompletedTasks: completed.length,
        tasksWithConfirmedUsage: confirmedUsageTaskIds.size,
      },
      responseRate: rate(linkedSubmittedPromptCount, shownPromptIds.size),
      taskCoverageRate: rate(completedTaskIds.size, completed.length),
      taskAdoptionRate: rate(confirmedUsageTaskIds.size, completedTaskIds.size),
      usageOutcomeDistribution,
      reasonDistribution,
      triggerDistribution: feedbackTriggerDistribution,
      platformDistribution: feedbackPlatformDistribution,
      promptVersionDistribution: feedbackPromptVersionDistribution,
      modelHumanAlignment,
    },
    recentEvents: events.slice(-20).reverse(),
  };
}

export async function getDashboardSummary(
  origin: DashboardDataOrigin = "real_user",
  feedbackFilters: DashboardFeedbackFilters = {},
): Promise<DashboardSummary> {
  const events = await readDashboardEvents();
  return summarizeDashboardEvents(events, origin, feedbackFilters);
}
