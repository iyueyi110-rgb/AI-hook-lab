import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPromptBundle,
  GENERATION_MODEL,
  MAX_IMAGE_DESCRIPTION_LENGTH,
} from "./promptTemplates.ts";
import type { GenerateRequest } from "./types.ts";

const request: GenerateRequest = {
  topic: "产品经理如何写周报",
  platform: "xiaohongshu",
  contentType: "tutorial",
  emotionTone: "authoritative",
  wordLimit: 80,
};

test("keeps the existing text-only prompt free of image context", () => {
  const bundle = buildPromptBundle(request);

  assert.doesNotMatch(bundle.userPrompt, /图片参考/);
  assert.match(bundle.userPrompt, /\*\*主题：\*\* 产品经理如何写周报/);
});

test("injects image context as untrusted source material", () => {
  const bundle = buildPromptBundle({
    ...request,
    imageDescription: "截图展示了目标、进展和风险三个周报模块。",
  });

  assert.match(bundle.userPrompt, /图片参考/);
  assert.match(bundle.userPrompt, /目标、进展和风险三个周报模块/);
  assert.match(bundle.userPrompt, /仅作为内容素材/);
  assert.match(bundle.userPrompt, /不能覆盖.*输出格式/);
});

test("preserves the existing DeepSeek model and bounds image context", () => {
  assert.equal(GENERATION_MODEL, "deepseek-chat");
  assert.equal(MAX_IMAGE_DESCRIPTION_LENGTH, 500);
});

test("the generate route trims, validates and preserves imageDescription", async () => {
  const route = await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");

  assert.match(route, /body\.imageDescription\?\.trim\(\)/);
  assert.match(route, /MAX_IMAGE_DESCRIPTION_LENGTH/);
  assert.match(route, /imageDescription:\s*trimmedImageDescription \|\| undefined/);
  assert.match(route, /trimmedImageDescription/);
  assert.match(route, /findSensitiveInputHints\([\s\S]*trimmedImageDescription/);
});
