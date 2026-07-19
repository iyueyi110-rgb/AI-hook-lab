import assert from "node:assert/strict";
import test from "node:test";

import { decideBriefPatch } from "./decision.ts";
import type { GenerationProvider, ProviderGenerationInput } from "./service.ts";

test("brief decisions use a low-temperature strict JSON contract", async () => {
  let captured: ProviderGenerationInput | undefined;
  const provider: GenerationProvider = {
    async generate(input) {
      captured = input;
      return { decisions: [{ patch: { platform: "douyin" } }] };
    },
  };
  const patch = await decideBriefPatch({
    message: "我想发在抖音",
    missingField: "platform",
    currentBrief: { topic: "AI 周报" },
  }, { provider });
  assert.deepEqual(patch, { platform: "douyin" });
  assert.equal(captured?.temperature, 0.2);
  assert.match(captured?.promptBundle.userPrompt ?? "", /untrusted user data/i);
  assert.match(captured?.promptBundle.userPrompt ?? "", /decisions/);
});

test("brief decisions reject fields outside the brief patch whitelist", async () => {
  await assert.rejects(
    () => decideBriefPatch({ message: "x", missingField: "platform", currentBrief: {} }, {
      provider: { async generate() { return { decisions: [{ patch: { platform: "douyin", hiddenReasoning: "secret" } }] }; } },
    }),
    /invalid_json/
  );
});
