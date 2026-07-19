import assert from "node:assert/strict";
import test from "node:test";
import { GenerationError, type GenerationProvider } from "./service.ts";
import { generateClassicHooks } from "./hooks.ts";

const request = {
  topic: "如何写好周报",
  platform: "xiaohongshu" as const,
  contentType: "tutorial" as const,
  wordLimit: 80,
};

function hookPayload(count: number) {
  return {
    hooks: Array.from({ length: count }, (_, index) => ({
      text: `第 ${index + 1} 条周报 Hook`,
      style: "清单式",
      reasoning: "用“周报”这个具体词说明内容价值。",
      scores: { impact: 8, platformFit: 7, actionability: 7, shareability: 6 },
    })),
    analysis: {
      bestStyle: "清单式",
      commonPattern: "从具体问题开场",
      improvementTip: "补充数据",
    },
  };
}

test("preserves the classic ten-hook response contract through the shared service", async () => {
  const provider: GenerationProvider = { async generate() { return hookPayload(10); } };

  const result = await generateClassicHooks({ request, provider });

  assert.equal(result.hooks.length, 10);
  assert.equal(result.topic, request.topic);
  assert.equal(result.platform, request.platform);
  assert.equal(result.contentType, request.contentType);
  assert.equal(result.model, "deepseek-chat");
  assert.equal(result.templateVersion, "v1.0.0");
  assert.equal(result.hooks[0]?.clickScore, 70);
  assert.deepEqual(result.analysis, hookPayload(10).analysis);
});

test("requires exactly ten classic hooks instead of truncating an oversized result", async () => {
  let calls = 0;
  const provider: GenerationProvider = {
    async generate() {
      calls += 1;
      return hookPayload(11);
    },
  };

  await assert.rejects(
    generateClassicHooks({ request, provider }),
    (error: unknown) => error instanceof GenerationError && error.code === "invalid_count"
  );
  assert.equal(calls, 3);
});
