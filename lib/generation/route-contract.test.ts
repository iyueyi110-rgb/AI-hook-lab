import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GenerationError } from "./service.ts";
import { mapGenerationError } from "./http.ts";

test("the generate route delegates to the quota-protected classic HTTP handler", async () => {
  const route = await readFile(new URL("../../app/api/generate/route.ts", import.meta.url), "utf8");

  assert.match(route, /handleClassicGenerateRequest/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.doesNotMatch(route, /api\.deepseek\.com/);
  assert.doesNotMatch(route, /\bcode\s*:/);
});

test("maps generation errors to the classic error payload without a code field", () => {
  const response = mapGenerationError(new GenerationError("invalid_json"));

  assert.deepEqual(response, {
    error: "生成结果异常",
    message: "本次结果未能正确处理，请重试。",
    status: 500,
  });
  assert.equal("code" in response, false);
});

test("does not expose upstream status details in the classic generic error message", () => {
  const response = mapGenerationError(new GenerationError("upstream", { status: 503 }));

  assert.deepEqual(response, {
    error: "生成服务繁忙",
    message: "模型服务暂时不可用，请稍后重试。",
    status: 502,
  });
});

test("maps an empty HTTP 200 model response to the classic 500 payload", () => {
  const response = mapGenerationError(new GenerationError("empty_response"));

  assert.deepEqual(response, {
    error: "生成结果异常",
    message: "本次没有获得有效结果，请重试。",
    status: 500,
  });
});

test("maps unavailable and authentication failures to safe operator-facing messages", () => {
  const unavailable = mapGenerationError(new GenerationError("missing_key"));
  const unauthorized = mapGenerationError(new GenerationError("auth"));

  assert.deepEqual(unavailable, {
    error: "生成服务暂不可用",
    message: "生成服务尚未完成配置，请稍后重试或联系维护者。",
    status: 503,
  });
  assert.deepEqual(unauthorized, {
    error: "生成服务暂不可用",
    message: "生成服务认证失败，请稍后重试或联系维护者。",
    status: 502,
  });
  assert.doesNotMatch(JSON.stringify({ unavailable, unauthorized }), /DEEPSEEK|\.env|API Key|platform\.deepseek/i);
});

test("maps invalid candidate counts to a user-readable recovery message", () => {
  assert.deepEqual(mapGenerationError(new GenerationError("invalid_count")), {
    error: "生成结果不完整",
    message: "本次未生成完整的 10 条候选，请重试。",
    status: 500,
  });
});
