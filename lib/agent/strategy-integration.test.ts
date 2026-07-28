import assert from "node:assert/strict";
import test from "node:test";

import { MemoryAgentRepository } from "./repository.ts";
import {
  createCreativeCoachService,
  type CoachGenerationRequest,
  type CreativeStrategyBridge,
} from "./service.ts";
import type { GenerateResponse } from "../types.ts";
import type { CreativeBrief } from "./types.ts";

const brief: CreativeBrief = {
  topic: "普通人如何理解大语言模型",
  platform: "douyin",
  contentType: "tutorial",
  targetAudience: "AI 新手",
  emotionTone: "curious",
  wordLimitBand: "30-50",
  avoidBadcaseTags: [],
};

function generated(request: CoachGenerationRequest): GenerateResponse {
  return {
    taskId: "task-1",
    generatedAt: new Date().toISOString(),
    topic: request.brief.topic,
    platform: request.brief.platform,
    contentType: request.brief.contentType,
    hooks: Array.from({ length: request.count }, (_, index) => ({
      id: `hook-${index}`,
      text: `候选 ${index}`,
      style: "直接",
      reasoning: "测试",
      overallScore: 8,
      scores: { impact: 8, platformFit: 8, actionability: 8, shareability: 8 },
      badcaseTags: [],
    })),
  };
}

function bridge(): CreativeStrategyBridge & {
  bound: string[];
  released: string[];
  feedback: Array<{ runId: string; fit: string; reason?: string }>;
} {
  const bound: string[] = [];
  const released: string[] = [];
  const feedback: Array<{ runId: string; fit: string; reason?: string }> = [];
  return {
    bound,
    released,
    feedback,
    async bindActive(runId, reference, scope) {
      assert.deepEqual(scope, { platform: "douyin", contentType: "tutorial" });
      bound.push(runId);
      return {
        runId,
        cardId: reference.id,
        strategyVersion: reference.version,
        appliedGuidanceHash: "a".repeat(64),
        boundAt: new Date().toISOString(),
      };
    },
    async resolveApplied(runId) {
      if (!bound.includes(runId)) return undefined;
      return {
        assignment: {
          runId,
          cardId: "strategy-1",
          strategyVersion: 2,
          appliedGuidanceHash: "a".repeat(64),
          boundAt: new Date().toISOString(),
        },
        guidance: { do: ["用具体结果开头"], avoid: ["避免书面化开场"] },
      };
    },
    async unbind(runId) {
      released.push(runId);
    },
    async recordFeedback(runId, fit, reason) {
      feedback.push({ runId, fit, ...(reason ? { reason } : {}) });
    },
  };
}

test("seeded Agent runs bind one strategy reference and store only id, version and hash", async () => {
  const strategy = bridge();
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    strategy,
    strategyCardsEnabled: true,
    generate: async (request) => generated(request),
    analyzeImage: async () => { throw new Error("unused"); },
  });
  const result = await service.createRun(undefined, {
    brief,
    strategyRef: { id: "strategy-1", version: 2 },
    seedCandidates: generated({ kind: "initial", count: 10, brief }).hooks.map((hook) => ({
      id: hook.id,
      text: hook.text,
      style: hook.style,
      reasoning: hook.reasoning,
      overallScore: hook.overallScore,
      scores: hook.scores,
      badcaseTags: hook.badcaseTags,
    })),
  });
  assert.equal(strategy.bound.length, 1);
  assert.deepEqual(result.response.run.strategyApplication, {
    id: "strategy-1",
    version: 2,
    appliedGuidanceHash: "a".repeat(64),
  });
  assert.equal("guidance" in result.response.run.strategyApplication!, false);
});

test("confirm_brief binds before provider quota work and sends transient approved guidance", async () => {
  const strategy = bridge();
  const requests: CoachGenerationRequest[] = [];
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    strategy,
    strategyCardsEnabled: true,
    generate: async (request) => {
      requests.push(request);
      return generated(request);
    },
    analyzeImage: async () => { throw new Error("unused"); },
  });
  const created = await service.createRun(undefined, { brief });
  const result = await service.submitTurn(
    created.sessionToken,
    created.response.run.id,
    0,
    { type: "confirm_brief", strategyRef: { id: "strategy-1", version: 2 } },
  );
  assert.equal(result.run.status, "reviewing");
  assert.deepEqual(requests[0]?.strategyGuidance, {
    do: ["用具体结果开头"],
    avoid: ["避免书面化开场"],
  });
});

test("strategy references fail closed when the feature switch is off", async () => {
  const strategy = bridge();
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    strategy,
    strategyCardsEnabled: false,
    generate: async (request) => generated(request),
    analyzeImage: async () => { throw new Error("unused"); },
  });
  await assert.rejects(
    () => service.createRun(undefined, {
      brief,
      strategyRef: { id: "strategy-1", version: 2 },
      seedCandidates: generated({ kind: "initial", count: 10, brief }).hooks,
    }),
    /strategy_cards_disabled/,
  );
  assert.equal(strategy.bound.length, 0);
});

test("strategy feedback is accepted only for an owned run with a bound strategy", async () => {
  const strategy = bridge();
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    strategy,
    strategyCardsEnabled: true,
    generate: async (request) => generated(request),
    analyzeImage: async () => { throw new Error("unused"); },
  });
  const created = await service.createRun(undefined, {
    brief,
    strategyRef: { id: "strategy-1", version: 2 },
    seedCandidates: generated({ kind: "initial", count: 10, brief }).hooks,
  });

  await service.recordStrategyFeedback(
    created.sessionToken,
    created.response.run.id,
    "not_applicable",
    "audience",
  );
  assert.deepEqual(strategy.feedback, [{
    runId: created.response.run.id,
    fit: "not_applicable",
    reason: "audience",
  }]);

  await assert.rejects(
    () => service.recordStrategyFeedback(undefined, created.response.run.id, "helpful"),
    /not found/i,
  );
});
