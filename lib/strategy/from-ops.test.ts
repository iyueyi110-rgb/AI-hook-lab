import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { OpsProvider } from "../agent/ops-provider.ts";
import { JsonOpsAgentRepository } from "../agent/ops-repository.ts";
import { JsonStrategyRepository } from "./repository.ts";
import { StrategyService } from "./service.ts";
import {
  StrategyFromOpsError,
  StrategyFromOpsService,
} from "./from-ops.ts";

function provider(content: unknown): OpsProvider {
  return {
    async complete() {
      return {
        content: JSON.stringify(content),
        toolCalls: [],
        assistantMessage: { role: "assistant", content: JSON.stringify(content) },
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      };
    },
  };
}

test("from-ops re-reads the canonical recommendation and fixes server evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strategy-from-ops-"));
  const opsRepository = new JsonOpsAgentRepository(path.join(directory, "ops.json"));
  const strategyRepository = new JsonStrategyRepository(path.join(directory, "strategies.json"));
  const strategyService = new StrategyService(
    strategyRepository,
    () => new Date("2026-07-28T00:00:00Z"),
  );
  let session = await opsRepository.create(
    "admin-1",
    new Date("2026-07-28T00:00:00Z"),
  );
  session.messages.push({
    id: "assistant-1",
    role: "assistant",
    content: "candidate",
    createdAt: "2026-07-28T00:00:00Z",
    answer: {
      status: "complete",
      summary: "summary",
      sources: [{
        id: "source-1",
        label: "dashboard",
        origin: "real_user",
        asOf: "2026-07-27T00:00:00Z",
        filters: { platform: "douyin" },
        sampleSize: 99,
        caveats: ["observational"],
        eligibility: "draft_only",
      }],
      findings: [],
      risks: [],
      recommendations: [{
        kind: "strategy_candidate",
        priority: "P0",
        action: "抖音教程用具体结果开头",
        rationale: "平台不匹配较多",
        sourceIds: ["source-1"],
      }],
      caveats: [],
      followUpQuestions: [],
    },
  });
  session = await opsRepository.save(session, 0);
  const service = new StrategyFromOpsService(
    opsRepository,
    strategyService,
    provider({
      title: "抖音教程具体结果策略",
      scopePairs: [{ platform: "douyin", contentType: "tutorial" }],
      audienceLabel: "教程受众",
      guidance: {
        do: ["使用口语化的具体结果开头"],
        avoid: ["避免使用本文将介绍"],
      },
      hypothesis: "降低平台不匹配 Bad Case",
    }),
    () => new Date("2026-07-28T00:00:00Z"),
  );

  const created = await service.createDraft({
    actorId: "admin-1",
    sessionId: session.id,
    assistantMessageId: "assistant-1",
    recommendationIndex: 0,
  });
  assert.equal(created.version.status, "draft");
  assert.equal(created.evidence.length, 1);
  assert.equal(created.evidence[0]?.sourceId, "source-1");
  assert.equal(created.evidence[0]?.sampleSize, 99);
  assert.equal(created.evidence[0]?.eligibility, "draft_only");
});

test("from-ops rejects analysis actions and enforces an hourly extraction cap", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "strategy-from-ops-limit-"));
  const opsRepository = new JsonOpsAgentRepository(path.join(directory, "ops.json"));
  const strategyService = new StrategyService(
    new JsonStrategyRepository(path.join(directory, "strategies.json")),
  );
  let session = await opsRepository.create("admin-1");
  session.messages.push({
    id: "assistant-1",
    role: "assistant",
    content: "analysis",
    createdAt: new Date().toISOString(),
    answer: {
      status: "partial",
      summary: "summary",
      sources: [],
      findings: [],
      risks: [],
      recommendations: [{
        kind: "analysis_action",
        priority: "P2",
        action: "collect more data",
        rationale: "insufficient",
        sourceIds: [],
      }],
      caveats: [],
      followUpQuestions: [],
    },
  });
  session = await opsRepository.save(session, 0);
  const service = new StrategyFromOpsService(
    opsRepository,
    strategyService,
    provider({}),
  );

  await assert.rejects(
    () => service.createDraft({
      actorId: "admin-1",
      sessionId: session.id,
      assistantMessageId: "assistant-1",
      recommendationIndex: 0,
    }),
    (error: unknown) =>
      error instanceof StrategyFromOpsError &&
      error.code === "ops_strategy_recommendation_not_found",
  );
  for (let index = 1; index < 10; index += 1) {
    await assert.rejects(
      () => service.createDraft({
        actorId: "admin-1",
        sessionId: session.id,
        assistantMessageId: "assistant-1",
        recommendationIndex: 0,
      }),
      /ops_strategy_recommendation_not_found/,
    );
  }
  await assert.rejects(
    () => service.createDraft({
      actorId: "admin-1",
      sessionId: session.id,
      assistantMessageId: "assistant-1",
      recommendationIndex: 0,
    }),
    /strategy_extraction_rate_limited/,
  );
});
