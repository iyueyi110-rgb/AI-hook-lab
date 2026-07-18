import assert from "node:assert/strict";
import test from "node:test";

import type { CoachGenerationRequest } from "../agent/service.ts";
import { generateCoachHooks } from "./coach.ts";
import type { GenerationProvider } from "./service.ts";

const brief = {
  topic: "AI 周报",
  platform: "douyin" as const,
  contentType: "video" as const,
  targetAudience: "产品经理",
  emotionTone: "curious" as const,
  wordLimitBand: "60-80" as const,
  avoidBadcaseTags: [],
};

function request(kind: CoachGenerationRequest["kind"], count: 3 | 10): CoachGenerationRequest {
  return {
    kind,
    count,
    brief,
    sourceCandidate: kind === "rewrite" ? {
      id: "source", text: "原始 Hook", style: "反差", reasoning: "具体理由", overallScore: 7,
      scores: { impact: 7, platformFit: 7, actionability: 7, shareability: 7 }, badcaseTags: [],
    } : undefined,
    instruction: kind === "rewrite" ? "更具体" : undefined,
    reason: kind === "regenerate" ? "太泛" : undefined,
  };
}

test("coach generation calls the shared strict candidate service for 10/3/10 tasks", async () => {
  const prompts: string[] = [];
  const provider: GenerationProvider = {
    async generate(input) {
      prompts.push(input.promptBundle.userPrompt);
      const match = input.promptBundle.userPrompt.match(/EXACT_COUNT=(\d+)/);
      const count = Number(match?.[1]);
      return { hooks: Array.from({ length: count }, (_, index) => ({
        text: `hook ${index}`, style: "反差", reasoning: `引用 hook ${index}`,
        scores: { impact: 8, platformFit: 8, actionability: 7, shareability: 7 }, overallScore: 8,
      })) };
    },
  };

  for (const [kind, count] of [["initial", 10], ["rewrite", 3], ["regenerate", 10]] as const) {
    const result = await generateCoachHooks(request(kind, count), { provider });
    assert.equal(result.hooks.length, count);
    assert.equal(result.topic, brief.topic);
  }
  assert.match(prompts[1]!, /原始 Hook/);
  assert.match(prompts[1]!, /更具体/);
  assert.match(prompts[2]!, /太泛/);
});

test("coach generation forwards shared retry and timeout controls", async () => {
  let attempts = 0;
  const result = await generateCoachHooks(request("rewrite", 3), {
    maxRetries: 2,
    timeoutMs: 100,
    provider: {
      async generate() {
        attempts += 1;
        return attempts === 1 ? { hooks: [] } : { hooks: Array.from({ length: 3 }, (_, index) => ({ text: `h${index}` })) };
      },
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.hooks.length, 3);
});

test("coach generation never exceeds the two-model-call turn budget", async () => {
  let attempts = 0;
  await assert.rejects(
    () => generateCoachHooks(request("initial", 10), {
      maxRetries: 2,
      provider: { async generate() { attempts += 1; return { hooks: [] }; } },
    }),
    /invalid_count/
  );
  assert.equal(attempts, 2);
});
