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
