import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GenerationError } from "./service.ts";
import { mapGenerationError } from "./http.ts";

test("the generate route delegates model generation to the shared service", async () => {
  const route = await readFile(new URL("../../app/api/generate/route.ts", import.meta.url), "utf8");

  assert.match(route, /generateClassicHooks/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.doesNotMatch(route, /api\.deepseek\.com/);
  assert.doesNotMatch(route, /\bcode\s*:/);
});

test("maps generation errors to the classic error payload without a code field", () => {
  const response = mapGenerationError(new GenerationError("invalid_json"));

  assert.deepEqual(response, {
    error: "JSON 解析失败",
    message: "AI 返回的不是有效 JSON，请重试",
    status: 500,
  });
  assert.equal("code" in response, false);
});

test("preserves the upstream HTTP status in the classic generic error message", () => {
  const response = mapGenerationError(new GenerationError("upstream", { status: 503 }));

  assert.deepEqual(response, {
    error: "AI 服务异常",
    message: "模型服务返回错误（503），请稍后重试",
    status: 502,
  });
});

test("maps an empty HTTP 200 model response to the classic 500 payload", () => {
  const response = mapGenerationError(new GenerationError("empty_response"));

  assert.deepEqual(response, {
    error: "AI 返回为空",
    message: "模型未返回有效内容，请重试",
    status: 500,
  });
});
