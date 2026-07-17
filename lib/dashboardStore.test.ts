import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { summarizeDashboardEvents, type DashboardEvent } from "./dashboardStore.ts";

const execFileAsync = promisify(execFile);
const dashboardStoreUrl = new URL("./dashboardStore.ts", import.meta.url).href;
const dashboardEventsRouteUrl = new URL(
  "../app/api/dashboard/events/route.ts",
  import.meta.url,
).href;
const projectRootUrl = new URL("../", import.meta.url).href;

function localPersistenceEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: "",
    NODE_ENV: "development",
    VERCEL_ENV: "",
  };
}

async function runModuleScript(
  directory: string,
  script: string,
  loaderPath?: string,
  environment = localPersistenceEnvironment(),
) {
  return execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      ...(loaderPath ? ["--experimental-loader", loaderPath] : []),
      "--input-type=module",
      "-e",
      script,
    ],
    {
      cwd: directory,
      env: environment,
    },
  );
}

async function readPersistedEvents(directory: string): Promise<DashboardEvent[]> {
  try {
    return JSON.parse(
      await readFile(path.join(directory, "data", "dashboard-events.json"), "utf8"),
    ) as DashboardEvent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

test("dashboard keeps model score separate from human satisfaction and data source", () => {
  const events: DashboardEvent[] = [
    { id: "1", type: "generation_start", timestamp: "2026-07-01T00:00:00Z", dataOrigin: "evaluation_set" },
    { id: "2", type: "generation_complete", timestamp: "2026-07-01T00:00:01Z", dataOrigin: "evaluation_set", payload: { hookCount: 10, avgScore: 8.8, templateVersion: "baseline" } },
    { id: "3", type: "platform_satisfaction", timestamp: "2026-07-01T00:00:02Z", dataOrigin: "real_user", payload: { rating: 3 } },
  ];

  const summary = summarizeDashboardEvents(events, "real_user");
  assert.equal(summary.averages.avgScore, 0);
  assert.equal(summary.averages.avgPlatformSatisfaction, 3);
  assert.deepEqual(summary.dataOriginDistribution, { real_user: 1, evaluation_set: 2, simulation: 0 });
});

test("dashboard summarizes creator feedback without treating behavior as a stated reason", () => {
  const events: DashboardEvent[] = [
    { id: "1", type: "generation_complete", timestamp: "2026-07-01T00:00:00Z", dataOrigin: "real_user", payload: { taskId: "task-1", hookCount: 10 } },
    { id: "2", type: "generation_complete", timestamp: "2026-07-01T00:00:01Z", dataOrigin: "real_user", payload: { taskId: "task-2", hookCount: 10 } },
    { id: "3", type: "generation_complete", timestamp: "2026-07-01T00:00:02Z", dataOrigin: "real_user", payload: { hookCount: 10 } },
    { id: "4", type: "hook_favorited", timestamp: "2026-07-01T00:00:03Z", dataOrigin: "real_user", payload: { taskId: "task-2", hookId: "hook-2" } },
    { id: "5", type: "creator_feedback", timestamp: "2026-07-01T00:00:04Z", dataOrigin: "real_user", payload: { promptId: "prompt-1", status: "shown", trigger: "adoption", scope: "hook", taskId: "task-1", hookId: "hook-1" } },
    { id: "6", type: "creator_feedback", timestamp: "2026-07-01T00:00:05Z", dataOrigin: "real_user", payload: { promptId: "prompt-1", status: "submitted", trigger: "adoption", scope: "hook", taskId: "task-1", hookId: "hook-1", usageOutcome: "direct_use", modelBadcaseTags: ["too_generic", "clickbait_risk"] } },
    { id: "7", type: "creator_feedback", timestamp: "2026-07-01T00:00:06Z", dataOrigin: "real_user", payload: { promptId: "prompt-2", status: "shown", trigger: "explicit_batch_reject", scope: "batch", taskId: "task-2" } },
    { id: "8", type: "creator_feedback", timestamp: "2026-07-01T00:00:07Z", dataOrigin: "real_user", payload: { promptId: "prompt-2", status: "submitted", trigger: "explicit_batch_reject", scope: "batch", taskId: "task-2", reasonTags: ["weak_reasoning", "platform_mismatch"], modelBadcaseTags: ["weak_reasoning"] } },
    { id: "9", type: "creator_feedback", timestamp: "2026-07-01T00:00:08Z", dataOrigin: "real_user", payload: { promptId: "prompt-3", status: "shown", trigger: "low_satisfaction", scope: "hook", taskId: "task-2", hookId: "hook-2" } },
    { id: "10", type: "creator_feedback", timestamp: "2026-07-01T00:00:09Z", dataOrigin: "real_user", payload: { promptId: "prompt-3", status: "skipped", trigger: "low_satisfaction", scope: "hook", taskId: "task-2", hookId: "hook-2" } },
  ];

  const summary = summarizeDashboardEvents(events, "real_user");
  assert.deepEqual(summary.feedback.totals, {
    promptsShown: 3,
    submitted: 2,
    skipped: 1,
    linkedCompletedTasks: 2,
    totalCompletedTasks: 3,
    tasksWithConfirmedUsage: 1,
  });
  assert.equal(summary.feedback.responseRate, 67);
  assert.equal(summary.feedback.taskCoverageRate, 67);
  assert.equal(summary.feedback.taskAdoptionRate, 50);
  assert.deepEqual(summary.feedback.usageOutcomeDistribution, { direct_use: 1 });
  assert.deepEqual(summary.feedback.reasonDistribution, { weak_reasoning: 1, platform_mismatch: 1 });
  assert.deepEqual(summary.feedback.triggerDistribution, { adoption: 1, explicit_batch_reject: 1 });
  assert.deepEqual(summary.feedback.modelHumanAlignment, {
    weak_reasoning: { agreed: 1, missedByModel: 0, modelOnly: 0 },
    clickbait_risk: { agreed: 0, missedByModel: 0, modelOnly: 1 },
    too_generic: { agreed: 0, missedByModel: 0, modelOnly: 1 },
    platform_mismatch: { agreed: 0, missedByModel: 1, modelOnly: 0 },
  });
});

test("dashboard feedback filters narrow platform, prompt version and trigger", () => {
  const events: DashboardEvent[] = [
    { id: "1", type: "creator_feedback", timestamp: "2026-07-01T00:00:00Z", dataOrigin: "real_user", payload: { promptId: "p1", status: "shown", trigger: "adoption", scope: "hook", taskId: "t1", hookId: "h1", platform: "douyin", templateVersion: "v1" } },
    { id: "2", type: "creator_feedback", timestamp: "2026-07-01T00:00:01Z", dataOrigin: "real_user", payload: { promptId: "p1", status: "submitted", trigger: "adoption", scope: "hook", taskId: "t1", hookId: "h1", platform: "douyin", templateVersion: "v1", usageOutcome: "direct_use" } },
    { id: "3", type: "creator_feedback", timestamp: "2026-07-01T00:00:02Z", dataOrigin: "real_user", payload: { promptId: "p2", status: "shown", trigger: "explicit_batch_reject", scope: "batch", taskId: "t2", platform: "xiaohongshu", templateVersion: "v2" } },
    { id: "4", type: "creator_feedback", timestamp: "2026-07-01T00:00:03Z", dataOrigin: "real_user", payload: { promptId: "p2", status: "submitted", trigger: "explicit_batch_reject", scope: "batch", taskId: "t2", platform: "xiaohongshu", templateVersion: "v2", reasonTags: ["too_generic"] } },
  ];

  const summary = summarizeDashboardEvents(events, "real_user", {
    platform: "xiaohongshu",
    promptVersion: "v2",
    trigger: "explicit_batch_reject",
  });

  assert.equal(summary.feedback.totals.promptsShown, 1);
  assert.equal(summary.feedback.totals.submitted, 1);
  assert.deepEqual(summary.feedback.triggerDistribution, { explicit_batch_reject: 1 });
  assert.deepEqual(summary.feedback.reasonDistribution, { too_generic: 1 });
});

test("feedback response rate only links submissions to prompts recorded as shown", () => {
  const events: DashboardEvent[] = [
    { id: "1", type: "creator_feedback", timestamp: "2026-07-01T00:00:00Z", dataOrigin: "real_user", payload: { promptId: "shown-only", status: "shown", trigger: "explicit_batch_reject", scope: "batch", taskId: "t1" } },
    { id: "2", type: "creator_feedback", timestamp: "2026-07-01T00:00:01Z", dataOrigin: "real_user", payload: { promptId: "submitted-only", status: "submitted", trigger: "explicit_batch_reject", scope: "batch", taskId: "t2", reasonTags: ["too_generic"] } },
  ];

  const summary = summarizeDashboardEvents(events, "real_user");
  assert.equal(summary.feedback.totals.promptsShown, 1);
  assert.equal(summary.feedback.totals.submitted, 1);
  assert.equal(summary.feedback.responseRate, 0);
});

test("unknown event origins are rejected instead of becoming real user data", async () => {
  await assert.rejects(
    () => import("./dashboardStore.ts").then(({ appendDashboardEvent }) => appendDashboardEvent({ type: "generation_start", dataOrigin: "unknown" })),
    /Unsupported dataOrigin/,
  );
});

test("dashboard persistence rejects malformed event-specific payloads without writing JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-store-invalid-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const invalidCases = [
      ["nested topic in platform", { type: "generation_start", payload: { platform: { topic: "private" }, contentType: "video" } }],
      ["nested hook count", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: { arbitrary: 99 } } }],
      ["nested badcase array", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, badcaseTags: [["too_long"]] } }],
      ["wrong scalar", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: "10" } }],
      ["not a number", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, avgScore: Number.NaN } }],
      ["infinite duration", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, durationMs: Number.POSITIVE_INFINITY } }],
      ["score out of range", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, avgScore: 10.1 } }],
      ["non-integer hook count", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1.5 } }],
      ["overlong identifier", { type: "hook_copied", payload: { hookId: "h".repeat(129) } }],
      ["private unknown field", { type: "generation_start", payload: { platform: "xiaohongshu", contentType: "video", topic: "private topic" } }],
      ["too many badcase tags", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, badcaseTags: Array(61).fill("too_long") } }],
      ["unknown badcase tag", { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, badcaseTags: ["private"] } }],
      ["unknown platform", { type: "generation_start", payload: { platform: "wechat", contentType: "video" } }],
      ["unknown content type", { type: "generation_start", payload: { platform: "xiaohongshu", contentType: "article" } }],
      ["object error", { type: "generation_error", payload: { error: { topic: "private" } } }],
      ["unknown error category", { type: "generation_error", payload: { error: "x".repeat(121) } }],
    ];
    const accepted = [];
    for (const [name, input] of invalidCases) {
      try {
        await appendDashboardEvent({ ...input, dataOrigin: "real_user" });
        accepted.push(name);
      } catch {}
    }
    process.stdout.write(JSON.stringify({ accepted }));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script);
    const result = JSON.parse(stdout) as { accepted: string[] };

    assert.deepEqual(result.accepted, []);
    assert.deepEqual(await readPersistedEvents(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard persistence accepts legal payload boundaries without mutating input", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-store-valid-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const allowedBadcaseTags = [
      "too_long",
      "too_short",
      "clickbait_risk",
      "too_generic",
      "weak_reasoning",
      "platform_mismatch",
    ];
    const payloads = [
      {
        platform: "x",
        contentType: "opinion",
        promptVariant: "baseline",
        topicId: "eval-topic-1",
      },
      {
        platform: "youtube",
        contentType: "product-ad",
        model: "m".repeat(100),
        templateVersion: "t".repeat(100),
        promptVariant: "candidate",
        hookCount: 100,
        avgScore: 10,
        avgClickScore: 100,
        durationMs: 600_000,
        badcaseTags: Array.from({ length: 60 }, (_, index) => allowedBadcaseTags[index % allowedBadcaseTags.length]),
      },
      { error: "请求超时" },
      {
        hookId: "h".repeat(128),
        style: "s".repeat(100),
        platform: "bilibili",
        contentType: "tutorial",
        templateVersion: "v".repeat(100),
        promptVariant: "candidate",
        clickScore: 100,
      },
      { hookId: "hook-1", rating: 5, clickScore: 0 },
    ];
    const inputs = [
      { type: "generation_start", payload: payloads[0] },
      { type: "generation_complete", payload: payloads[1] },
      { type: "generation_error", payload: payloads[2] },
      { type: "hook_copied", payload: payloads[3] },
      { type: "platform_satisfaction", payload: payloads[4] },
    ];
    const before = JSON.stringify(payloads);
    const events = [];
    for (const input of inputs) {
      events.push(await appendDashboardEvent({ ...input, dataOrigin: "real_user" }));
    }
    process.stdout.write(JSON.stringify({ events, unchanged: JSON.stringify(payloads) === before }));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script);
    const result = JSON.parse(stdout) as { events: DashboardEvent[]; unchanged: boolean };
    const persisted = await readPersistedEvents(directory);

    assert.equal(result.unchanged, true);
    assert.equal(result.events.length, 5);
    assert.deepEqual(result.events[0]?.payload, {
      platform: "x",
      contentType: "opinion",
      promptVariant: "baseline",
    });
    assert.deepEqual(
      persisted.map(({ type, payload }) => ({ type, payload })),
      result.events.map(({ type, payload }) => ({ type, payload })),
    );
    assert.equal(persisted[1]?.payload?.hookCount, 100);
    assert.equal((persisted[1]?.payload?.badcaseTags as string[]).length, 60);
    assert.equal(persisted[3]?.payload?.clickScore, 100);
    assert.equal(persisted[4]?.payload?.rating, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creator feedback persists valid lifecycle events and browser task context", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "creator-feedback-valid-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const shared = {
      promptId: "prompt-1",
      anonymousCreatorId: "creator-1",
      taskId: "task-1",
      platform: "xiaohongshu",
      contentType: "video",
      templateVersion: "v2",
      promptVariant: "candidate",
      clickScore: 82,
      modelBadcaseTags: ["too_generic", "platform_mismatch"],
    };
    const inputs = [
      { ...shared, status: "shown", trigger: "adoption", scope: "hook", hookId: "hook-1" },
      { ...shared, status: "submitted", trigger: "adoption", scope: "hook", hookId: "hook-1", usageOutcome: "direct_use" },
      { ...shared, promptId: "prompt-2", status: "submitted", trigger: "adoption", scope: "hook", hookId: "hook-2", usageOutcome: "light_edit", reasonTags: ["tone_mismatch"], comment: "语气再自然一点" },
      { ...shared, promptId: "prompt-3", status: "submitted", trigger: "explicit_batch_reject", scope: "batch", reasonTags: ["not_relevant", "repetitive"] },
      { ...shared, promptId: "prompt-4", status: "skipped", trigger: "low_satisfaction", scope: "hook", hookId: "hook-3" },
    ];
    const events = [];
    for (const payload of inputs) {
      events.push(await appendDashboardEvent({ type: "creator_feedback", payload, dataOrigin: "real_user" }));
    }
    process.stdout.write(JSON.stringify(events));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script);
    const events = JSON.parse(stdout) as DashboardEvent[];
    assert.equal(events.length, 5);
    assert.equal(events[1]?.payload?.usageOutcome, "direct_use");
    assert.deepEqual(events[2]?.payload?.reasonTags, ["tone_mismatch"]);
    assert.equal(events[3]?.payload?.hookId, undefined);
    assert.equal((await readPersistedEvents(directory)).length, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creator feedback rejects invalid conditions, private content and personal information", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "creator-feedback-invalid-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const base = {
      promptId: "prompt-1",
      anonymousCreatorId: "creator-1",
      taskId: "task-1",
      status: "submitted",
      trigger: "explicit_batch_reject",
      scope: "batch",
      reasonTags: ["too_generic"],
    };
    const invalid = [
      { ...base, reasonTags: [] },
      { ...base, reasonTags: ["too_generic", "repetitive", "not_relevant", "other"] },
      { ...base, reasonTags: ["invented_reason"] },
      { ...base, comment: "x".repeat(101) },
      { ...base, comment: "   " },
      { ...base, comment: "联系我 test@example.com" },
      { ...base, topic: "private topic" },
      { ...base, hookText: "private hook" },
      { ...base, scope: "hook" },
      { ...base, scope: "batch", hookId: "hook-1" },
      { ...base, status: "shown", reasonTags: ["too_generic"] },
      { ...base, trigger: "adoption", scope: "hook", hookId: "hook-1", usageOutcome: "light_edit", reasonTags: [] },
      { ...base, trigger: "adoption", scope: "hook", hookId: "hook-1", usageOutcome: "direct_use", reasonTags: ["too_generic"] },
    ];
    const accepted = [];
    for (const payload of invalid) {
      try {
        await appendDashboardEvent({ type: "creator_feedback", payload, dataOrigin: "real_user" });
        accepted.push(payload);
      } catch {}
    }
    process.stdout.write(JSON.stringify({ accepted }));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script);
    const result = JSON.parse(stdout) as { accepted: unknown[] };
    assert.deepEqual(result.accepted, []);
    assert.deepEqual(await readPersistedEvents(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generation and interaction events accept anonymous creator and task linkage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-task-linkage-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const context = { anonymousCreatorId: "creator-1", taskId: "task-1" };
    const inputs = [
      { type: "generation_start", payload: { ...context, platform: "douyin", contentType: "video" } },
      { type: "generation_complete", payload: { ...context, platform: "douyin", contentType: "video", hookCount: 10 } },
      { type: "hook_favorited", payload: { ...context, hookId: "hook-1" } },
      { type: "platform_satisfaction", payload: { ...context, hookId: "hook-1", rating: 2 } },
    ];
    const events = [];
    for (const input of inputs) events.push(await appendDashboardEvent({ ...input, dataOrigin: "real_user" }));
    process.stdout.write(JSON.stringify(events));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script);
    const events = JSON.parse(stdout) as DashboardEvent[];
    assert.equal(events.length, 4);
    assert.ok(events.every((event) => event.payload?.taskId === "task-1"));
    assert.ok(events.every((event) => event.payload?.anonymousCreatorId === "creator-1"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard events API returns 400 for invalid payloads and only persists a legal boundary", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-route-"));
  const loaderPath = path.join(directory, "alias-loader.mjs");
  await writeFile(
    loaderPath,
    `
      const projectRoot = ${JSON.stringify(projectRootUrl)};
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "next/server") {
          return nextResolve("next/server.js", context);
        }
        if (specifier.startsWith("@/")) {
          return {
            shortCircuit: true,
            url: new URL(specifier.slice(2) + ".ts", projectRoot).href,
          };
        }
        return nextResolve(specifier, context);
      }
    `,
    "utf8",
  );
  const script = `
    const { POST } = await import(${JSON.stringify(dashboardEventsRouteUrl)});
    const requests = [
      { type: "generation_start", payload: { platform: { topic: "private" }, contentType: "video" } },
      { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: -1 } },
      { type: "generation_complete", payload: { platform: "xiaohongshu", hookCount: 1, badcaseTags: [["too_long"]] } },
      { type: "generation_error", payload: { error: 500 } },
      {
        type: "generation_complete",
        payload: {
          platform: "x",
          contentType: "opinion",
          model: "m".repeat(100),
          templateVersion: "t".repeat(100),
          promptVariant: "candidate",
          hookCount: 100,
          avgScore: 10,
          avgClickScore: 100,
          durationMs: 600_000,
          badcaseTags: Array(60).fill("too_long"),
        },
      },
    ];
    const responses = [];
    for (const body of requests) {
      const response = await POST(new Request("http://localhost/api/dashboard/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      responses.push({ status: response.status, body: await response.json() });
    }
    process.stdout.write(JSON.stringify(responses));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script, loaderPath);
    const responses = JSON.parse(stdout) as Array<{ status: number; body: unknown }>;
    const persisted = await readPersistedEvents(directory);

    assert.deepEqual(responses.map(({ status }) => status), [400, 400, 400, 400, 200]);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.type, "generation_complete");
    assert.equal(persisted[0]?.payload?.hookCount, 100);

    const productionInvalidScript = `
      const { POST } = await import(${JSON.stringify(dashboardEventsRouteUrl)});
      const response = await POST(new Request("http://localhost/api/dashboard/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generation_start",
          payload: { platform: { topic: "private" }, contentType: "video" },
        }),
      }));
      process.stdout.write(JSON.stringify({ status: response.status }));
    `;
    const { stdout: productionStdout } = await runModuleScript(
      directory,
      productionInvalidScript,
      loaderPath,
      {
        ...localPersistenceEnvironment(),
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      },
    );
    assert.equal((JSON.parse(productionStdout) as { status: number }).status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard events API accepts bounded numeric eval topic IDs without persisting them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-topic-id-route-"));
  const loaderPath = path.join(directory, "alias-loader.mjs");
  await writeFile(
    loaderPath,
    `
      const projectRoot = ${JSON.stringify(projectRootUrl)};
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === "next/server") {
          return nextResolve("next/server.js", context);
        }
        if (specifier.startsWith("@/")) {
          return {
            shortCircuit: true,
            url: new URL(specifier.slice(2) + ".ts", projectRoot).href,
          };
        }
        return nextResolve(specifier, context);
      }
    `,
    "utf8",
  );
  const script = `
    const { POST } = await import(${JSON.stringify(dashboardEventsRouteUrl)});
    const topicIds = [
      1,
      -1,
      1.5,
      1_000_001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { topic: "private" },
      [1],
    ];
    const responses = [];
    for (const topicId of topicIds) {
      const response = await POST(new Request("http://localhost/api/dashboard/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generation_start",
          dataOrigin: "evaluation_set",
          payload: { platform: "xiaohongshu", promptVariant: "candidate", topicId },
        }),
      }));
      responses.push({ status: response.status, body: await response.json() });
    }
    process.stdout.write(JSON.stringify(responses));
  `;

  try {
    const { stdout } = await runModuleScript(directory, script, loaderPath);
    const responses = JSON.parse(stdout) as Array<{
      status: number;
      body: { event?: DashboardEvent };
    }>;
    const persisted = await readPersistedEvents(directory);

    assert.deepEqual(
      responses.map(({ status }) => status),
      [200, 400, 400, 400, 400, 400, 400, 400],
    );
    assert.deepEqual(responses[0]?.body.event?.payload, {
      platform: "xiaohongshu",
      promptVariant: "candidate",
    });
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0]?.payload, {
      platform: "xiaohongshu",
      promptVariant: "candidate",
    });
    assert.equal(Object.hasOwn(persisted[0]?.payload ?? {}, "topicId"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
