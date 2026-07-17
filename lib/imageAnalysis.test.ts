import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_IMAGE_ANALYSIS_TIMEOUT_MS,
  handleAnalyzeImageRequest,
  imageFileToDataUrl,
  MAX_IMAGE_BYTES,
  parseDoubaoAnalysisResponse,
  validateImageUpload,
} from "./imageAnalysis.ts";

const signatures = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
} as const;

function imageFile(type: keyof typeof signatures, extraBytes = 0): File {
  return new File(
    [new Uint8Array(signatures[type]), new Uint8Array(extraBytes)],
    `fixture.${type.split("/")[1]}`,
    { type }
  );
}

function doubaoResponse(content: unknown): unknown {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

test("accepts JPEG, PNG and WebP files with matching signatures", async () => {
  for (const type of Object.keys(signatures) as Array<keyof typeof signatures>) {
    assert.deepEqual(await validateImageUpload(imageFile(type)), { ok: true });
  }
});

test("rejects empty and oversized image files", async () => {
  const empty = new File([], "empty.png", { type: "image/png" });
  const oversized = imageFile("image/jpeg", MAX_IMAGE_BYTES);

  assert.equal((await validateImageUpload(empty)).status, 400);
  assert.equal((await validateImageUpload(oversized)).status, 413);
});

test("rejects unsupported MIME types and mismatched file signatures", async () => {
  const unsupported = new File([new Uint8Array([1, 2, 3])], "note.gif", {
    type: "image/gif",
  });
  const disguised = new File([new Uint8Array(signatures["image/jpeg"])], "fake.png", {
    type: "image/png",
  });

  assert.equal((await validateImageUpload(unsupported)).status, 400);
  assert.equal((await validateImageUpload(disguised)).status, 400);
});

test("converts an image to a MIME-preserving base64 data URL", async () => {
  const result = await imageFileToDataUrl(imageFile("image/png"));

  assert.match(result, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(result.split(",")[1], "base64")[0], 0x89);
});

test("parses and validates a structured Doubao analysis response", () => {
  const parsed = parseDoubaoAnalysisResponse(
    doubaoResponse({
      topic: "三步写好产品周报",
      imageDescription: "一张产品周报教程截图，包含目标、进展和风险三个模块。",
      suggestedPlatform: "xiaohongshu",
      suggestedContentType: "tutorial",
      suggestedEmotionTone: "authoritative",
    })
  );

  assert.equal(parsed.topic, "三步写好产品周报");
  assert.equal(parsed.suggestedContentType, "tutorial");
});

test("rejects malformed, incomplete or out-of-contract Doubao responses", () => {
  assert.throws(() => parseDoubaoAnalysisResponse({ choices: [] }), /有效内容/);
  assert.throws(
    () => parseDoubaoAnalysisResponse({ choices: [{ message: { refusal: "cannot analyze" } }] }),
    /有效内容/
  );
  assert.throws(
    () => parseDoubaoAnalysisResponse({ choices: [{ message: { content: "not-json" } }] }),
    /有效 JSON/
  );
  assert.throws(
    () => parseDoubaoAnalysisResponse(doubaoResponse({ topic: "只有主题" })),
    /格式不完整/
  );
  assert.throws(
    () => parseDoubaoAnalysisResponse(doubaoResponse({ ...validAnalysis, topic: "   " })),
    /格式不完整/
  );
  assert.throws(
    () => parseDoubaoAnalysisResponse(doubaoResponse({ ...validAnalysis, extra: "unexpected" })),
    /额外字段/
  );
  assert.throws(
    () =>
      parseDoubaoAnalysisResponse(
        doubaoResponse({
          topic: "测试",
          imageDescription: "描述",
          suggestedPlatform: "invalid",
          suggestedContentType: "video",
          suggestedEmotionTone: "curious",
        })
      ),
    /推荐值无效/
  );
  assert.throws(
    () =>
      parseDoubaoAnalysisResponse(
        doubaoResponse({
          topic: "测试",
          imageDescription: "图".repeat(501),
          suggestedPlatform: "douyin",
          suggestedContentType: "video",
          suggestedEmotionTone: "curious",
        })
      ),
    /描述过长/
  );
});

function analyzeRequest(file: File): Request {
  const formData = new FormData();
  formData.set("image", file);
  return new Request("http://localhost/api/analyze-image", {
    method: "POST",
    body: formData,
  });
}

const validAnalysis = {
  topic: "三步写好产品周报",
  imageDescription: "一张产品周报教程截图，包含目标、进展和风险三个模块。",
  suggestedPlatform: "xiaohongshu",
  suggestedContentType: "tutorial",
  suggestedEmotionTone: "authoritative",
};

test("sends a validated image to Doubao with JSON Schema output", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json(doubaoResponse(validAnalysis));
  };

  const response = await handleAnalyzeImageRequest(analyzeRequest(imageFile("image/png")), {
    apiKey: "test-key",
    model: "doubao-vision-test",
    fetchImpl,
  });
  const body = await response.json();
  const upstreamBody = JSON.parse(String(capturedInit?.body));

  assert.equal(response.status, 200);
  assert.equal(body.topic, validAnalysis.topic);
  assert.equal(capturedUrl, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(upstreamBody.model, "doubao-vision-test");
  assert.equal(upstreamBody.response_format.type, "json_schema");
  assert.equal(upstreamBody.response_format.json_schema.strict, true);
  assert.equal(upstreamBody.response_format.json_schema.schema.additionalProperties, false);
  assert.match(upstreamBody.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.doesNotMatch(JSON.stringify(upstreamBody), /store/);
});

test("returns 501 when Doubao credentials or model configuration is absent", async () => {
  const file = imageFile("image/jpeg");
  const withoutKey = await handleAnalyzeImageRequest(analyzeRequest(file), {
    apiKey: "",
    model: "doubao-vision-test",
  });
  const withoutModel = await handleAnalyzeImageRequest(analyzeRequest(file), {
    apiKey: "test-key",
    model: "",
  });

  assert.equal(withoutKey.status, 501);
  assert.equal(withoutModel.status, 501);
});

test("returns upload validation errors without calling Doubao", async () => {
  let called = false;
  const response = await handleAnalyzeImageRequest(
    analyzeRequest(new File([], "empty.png", { type: "image/png" })),
    {
      apiKey: "test-key",
      model: "doubao-vision-test",
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    }
  );

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("maps Doubao authentication, rate limit and service errors", async () => {
  for (const [upstreamStatus, expectedStatus] of [
    [401, 502],
    [429, 429],
    [500, 502],
  ] as const) {
    const response = await handleAnalyzeImageRequest(analyzeRequest(imageFile("image/webp")), {
      apiKey: "test-key",
      model: "doubao-vision-test",
      fetchImpl: async () => new Response("upstream error", { status: upstreamStatus }),
    });
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(Object.keys(await response.json()).sort(), ["error", "message"]);
  }
});

test("returns 502 when Doubao returns invalid JSON or an invalid analysis", async () => {
  const invalidHttpJson = await handleAnalyzeImageRequest(analyzeRequest(imageFile("image/png")), {
    apiKey: "test-key",
    model: "doubao-vision-test",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  const invalidAnalysis = await handleAnalyzeImageRequest(analyzeRequest(imageFile("image/png")), {
    apiKey: "test-key",
    model: "doubao-vision-test",
    fetchImpl: async () => Response.json(doubaoResponse({ topic: "缺少字段" })),
  });

  assert.equal(invalidHttpJson.status, 502);
  assert.equal(invalidAnalysis.status, 502);
});

test("aborts a slow Doubao request and returns 504", async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const response = await handleAnalyzeImageRequest(analyzeRequest(imageFile("image/jpeg")), {
    apiKey: "test-key",
    model: "doubao-vision-test",
    fetchImpl,
    timeoutMs: 5,
  });

  assert.equal(response.status, 504);
  assert.equal((await response.json()).message, "图片识别超过 1 秒，请重试");
});

test("allows production cold starts more time than the previous 15 second limit", async () => {
  assert.equal(DEFAULT_IMAGE_ANALYSIS_TIMEOUT_MS, 30_000);

  const route = await readFile(
    new URL("../app/api/analyze-image/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(route, /export const maxDuration = 35/);
});

test("the Next route wires ARK configuration into the tested handler", async () => {
  const [route, envExample] = await Promise.all([
    readFile(new URL("../app/api/analyze-image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.local.example", import.meta.url), "utf8"),
  ]);

  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /handleAnalyzeImageRequest/);
  assert.match(route, /process\.env\.ARK_API_KEY/);
  assert.match(route, /process\.env\.ARK_MODEL_ID/);
  assert.match(envExample, /^ARK_API_KEY=$/m);
  assert.match(envExample, /^ARK_MODEL_ID=$/m);
});
