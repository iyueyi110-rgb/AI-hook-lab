import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  candidateRowsToCsv,
  listCandidateFunnelRows,
  persistGenerationComplete,
  persistGenerationStart,
  summarizeCandidateFunnel,
} from "./candidateAnalytics.ts";
import type { GenerateRequest, GenerateResponse } from "./types.ts";

const request: GenerateRequest = {
  taskId: "task-analytics-001",
  topic: "不会进入分析存储的原始主题",
  platform: "douyin",
  contentType: "tutorial",
  promptVariant: "candidate",
};

const response: GenerateResponse = {
  taskId: request.taskId,
  hooks: [
    {
      id: "hook-001",
      text: "不会进入分析存储的 Hook 文案",
      style: "清单式",
      reasoning: "不会进入分析存储的推荐理由",
      clickScore: 82,
      overallScore: 8,
      badcaseTags: ["weak_reasoning"],
    },
    {
      id: "hook-002",
      text: "第二条候选",
      style: "反差式",
      reasoning: "具体理由",
      clickScore: 74,
      overallScore: 7,
    },
  ],
  generatedAt: "2026-08-07T00:00:01.000Z",
  topic: request.topic,
  platform: request.platform,
  contentType: request.contentType,
  model: "deepseek-chat",
  templateVersion: "v1.0.0",
  promptVariant: "candidate",
};

test("candidate analytics persists one row per candidate without raw content", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-hook-candidate-"));
  const env = {
    NODE_ENV: "development",
    CANDIDATE_ANALYTICS_STORE_PATH: path.join(directory, "candidate-analytics.json"),
  } as NodeJS.ProcessEnv;
  try {
    await persistGenerationStart({ taskId: request.taskId!, request, startedAt: "2026-08-07T00:00:00.000Z", env });
    await persistGenerationComplete({ taskId: request.taskId!, request, response, startedAt: "2026-08-07T00:00:00.000Z", env });
    await persistGenerationComplete({ taskId: request.taskId!, request, response, startedAt: "2026-08-07T00:00:00.000Z", env });

    const rows = await listCandidateFunnelRows({ env });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.hookId), ["hook-001", "hook-002"]);
    assert.equal(rows[0]?.taskStatus, "completed");
    assert.deepEqual(rows[0]?.badcaseTags, ["weak_reasoning"]);

    const raw = await readFile(env.CANDIDATE_ANALYTICS_STORE_PATH!, "utf8");
    assert.doesNotMatch(raw, /不会进入分析存储/);

    const summary = summarizeCandidateFunnel(rows);
    assert.equal(summary.totals.tasks, 1);
    assert.equal(summary.totals.candidates, 2);
    assert.equal(summary.byPlatform.douyin?.candidates, 2);
    assert.equal(summary.byPromptVersion["v1.0.0"]?.tasks, 1);
    assert.equal(summary.byBadcaseType.weak_reasoning, 1);

    const csv = candidateRowsToCsv(rows);
    assert.match(csv, /^task_id,hook_id,position,/);
    assert.match(csv, /task-analytics-001,hook-001,1/);
    assert.doesNotMatch(csv, /不会进入分析存储/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
