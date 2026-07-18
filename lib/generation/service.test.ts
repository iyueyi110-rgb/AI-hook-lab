import assert from "node:assert/strict";
import test from "node:test";
import {
  GenerationError,
  createDeepSeekProvider,
  generateCandidates,
  type GenerationProvider,
  type ProviderGenerationInput,
} from "./service.ts";

const promptBundle = {
  model: "deepseek-chat",
  templateVersion: "v1.0.0",
  promptVariant: "candidate",
  systemPrompt: "system prompt",
  userPrompt: "user prompt",
  styles: ["style-a", "style-b"],
};

function payload(count: number) {
  return {
    hooks: Array.from({ length: count }, (_, index) => ({
      text: `hook ${index + 1}`,
      style: "style-a",
      reasoning: "specific rationale",
    })),
  };
}

test("generates exactly the requested number of candidates through an injected provider", async () => {
  const calls: ProviderGenerationInput[] = [];
  const provider: GenerationProvider = {
    async generate(input) {
      calls.push(input);
      return payload(3);
    },
  };

  const result = await generateCandidates({
    promptBundle,
    expectedCount: 3,
    provider,
    temperature: 0.42,
    maxTokens: 512,
  });

  assert.equal(result.candidates.length, 3);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.payload, payload(3));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.promptBundle, promptBundle);
  assert.equal(calls[0]?.temperature, 0.42);
  assert.equal(calls[0]?.maxTokens, 512);
  assert.ok(calls[0]?.signal instanceof AbortSignal);
});

test("retries invalid JSON and candidate count failures no more than twice", async () => {
  let callCount = 0;
  const provider: GenerationProvider = {
    async generate() {
      callCount += 1;
      if (callCount === 1) return "not json";
      if (callCount === 2) return payload(2);
      return payload(3);
    },
  };

  const result = await generateCandidates({
    promptBundle,
    expectedCount: 3,
    provider,
    maxRetries: 2,
  });

  assert.equal(result.candidates.length, 3);
  assert.equal(result.attempts, 3);
  assert.equal(callCount, 3);
});

test("returns a structured invalid_count error after retrying an incorrect count", async () => {
  let callCount = 0;
  const provider: GenerationProvider = {
    async generate() {
      callCount += 1;
      return payload(2);
    },
  };

  await assert.rejects(
    generateCandidates({ promptBundle, expectedCount: 3, provider, maxRetries: 9 }),
    (error: unknown) =>
      error instanceof GenerationError &&
      error.code === "invalid_count" &&
      error.attempts === 3
  );
  assert.equal(callCount, 3);
});

test("does not retry provider failures that are not JSON or count errors", async () => {
  let callCount = 0;
  const provider: GenerationProvider = {
    async generate() {
      callCount += 1;
      throw new GenerationError("rate_limit");
    },
  };

  await assert.rejects(
    generateCandidates({ promptBundle, expectedCount: 3, provider, maxRetries: 2 }),
    (error: unknown) => error instanceof GenerationError && error.code === "rate_limit"
  );
  assert.equal(callCount, 1);
});

test("uses an injected fetch implementation for DeepSeek without exposing the API key in errors", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload(2)) } }],
      }),
      { status: 200 }
    );
  };

  const result = await generateCandidates({
    promptBundle,
    expectedCount: 2,
    apiKey: "secret-key",
    fetch: fetcher,
    temperature: 0.3,
    maxTokens: 256,
  });

  assert.equal(result.candidates.length, 2);
  assert.equal(request?.url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer secret-key");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ],
    temperature: 0.3,
    max_tokens: 256,
    response_format: { type: "json_object" },
  });

  await assert.rejects(
    createDeepSeekProvider({}).generate({ promptBundle }),
    (error: unknown) =>
      error instanceof GenerationError &&
      error.code === "missing_key" &&
      !error.message.includes("secret-key")
  );
});

test("maps DeepSeek HTTP and timeout failures to safe structured errors", async () => {
  for (const [status, code] of [
    [401, "auth"],
    [429, "rate_limit"],
    [503, "upstream"],
  ] as const) {
    await assert.rejects(
      createDeepSeekProvider({
        apiKey: "secret-key",
        fetch: async () => new Response("provider details", { status }),
      }).generate({ promptBundle }),
      (error: unknown) => error instanceof GenerationError && error.code === code
    );
  }

  await assert.rejects(
    createDeepSeekProvider({
      apiKey: "secret-key",
      timeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    }).generate({ promptBundle }),
    (error: unknown) => error instanceof GenerationError && error.code === "timeout"
  );
});

test("enforces timeoutMs for an injected provider with a real delayed operation", async () => {
  const provider: GenerationProvider = {
    async generate(input) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (input.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return payload(3);
    },
  };

  await assert.rejects(
    generateCandidates({ promptBundle, expectedCount: 3, provider, timeoutMs: 1 }),
    (error: unknown) => error instanceof GenerationError && error.code === "timeout"
  );
});
