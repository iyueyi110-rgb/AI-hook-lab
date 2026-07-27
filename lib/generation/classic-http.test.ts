import assert from "node:assert/strict";
import test from "node:test";

import { MemoryAgentRepository } from "../agent/repository.ts";
import type { GenerateResponse } from "../types.ts";
import { createClassicGenerateHandler } from "./classic-http.ts";
import {
  classicGenerationQuotaFromEnv,
  DEFAULT_CLASSIC_GENERATION_QUOTA,
} from "./quota.ts";
import { GenerationError } from "./service.ts";

const requestBody = {
  topic: "如何写好周报",
  platform: "xiaohongshu" as const,
  contentType: "tutorial" as const,
  wordLimit: 80,
};

function generatedResponse(): GenerateResponse {
  return {
    hooks: [],
    generatedAt: "2026-07-21T00:00:00.000Z",
    topic: requestBody.topic,
    platform: requestBody.platform,
    contentType: requestBody.contentType,
    model: "deepseek-chat",
    templateVersion: "v1.0.0",
    promptVariant: "candidate",
  };
}

function post(ip: string, body: unknown = requestBody): Request {
  return new Request("https://example.test/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: "test-key",
    AGENT_IP_HASH_SECRET: "test-secret",
    AGENT_TRUSTED_IP_HEADER: "x-real-ip",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("classic quota environment uses safe defaults and positive overrides", () => {
  assert.deepEqual(classicGenerationQuotaFromEnv({} as NodeJS.ProcessEnv), DEFAULT_CLASSIC_GENERATION_QUOTA);
  assert.deepEqual(classicGenerationQuotaFromEnv({
    CLASSIC_QUOTA_WINDOW_SECONDS: "2",
    CLASSIC_QUOTA_IP_GENERATIONS: "3",
  } as NodeJS.ProcessEnv), { windowMs: 2_000, ipGenerations: 3 });
  assert.deepEqual(classicGenerationQuotaFromEnv({
    CLASSIC_QUOTA_WINDOW_SECONDS: "0",
    CLASSIC_QUOTA_IP_GENERATIONS: "invalid",
  } as NodeJS.ProcessEnv), DEFAULT_CLASSIC_GENERATION_QUOTA);
});

test("classic generation limits the same IP, isolates other IPs and resets the window", async () => {
  const repository = new MemoryAgentRepository();
  let current = new Date("2026-07-21T00:00:00.000Z");
  const handler = createClassicGenerateHandler({
    repository,
    env: env({ CLASSIC_QUOTA_WINDOW_SECONDS: "1", CLASSIC_QUOTA_IP_GENERATIONS: "1" }),
    now: () => current,
    generate: async () => generatedResponse(),
  });

  assert.equal((await handler(post("203.0.113.10"))).status, 200);
  const limited = await handler(post("203.0.113.10"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1");
  assert.equal("code" in await limited.json(), false);
  assert.equal((await handler(post("203.0.113.11"))).status, 200);

  current = new Date("2026-07-21T00:00:01.001Z");
  assert.equal((await handler(post("203.0.113.10"))).status, 200);

  const stored = await repository.read();
  assert.equal(stored.usage?.filter((item) => item.kind === "classic_generation").length, 2);
  assert.doesNotMatch(JSON.stringify(stored), /203\.0\.113\./);
});

test("invalid input does not consume quota while a provider failure does", async () => {
  const repository = new MemoryAgentRepository();
  let fail = false;
  const handler = createClassicGenerateHandler({
    repository,
    env: env({ CLASSIC_QUOTA_IP_GENERATIONS: "1" }),
    generate: async () => {
      if (fail) throw new GenerationError("upstream", { status: 503 });
      return generatedResponse();
    },
  });

  assert.equal((await handler(post("198.51.100.2", { topic: "" }))).status, 400);
  fail = true;
  assert.equal((await handler(post("198.51.100.2"))).status, 502);
  assert.equal((await handler(post("198.51.100.2"))).status, 429);
});

test("production classic generation fails closed without a valid IP hash secret", async () => {
  const handler = createClassicGenerateHandler({
    repository: new MemoryAgentRepository(),
    production: true,
    env: {
      NODE_ENV: "production",
      DEEPSEEK_API_KEY: "test-key",
      AGENT_IP_HASH_SECRET: "replace_me",
    } as NodeJS.ProcessEnv,
    generate: async () => generatedResponse(),
  });

  const response = await handler(post("192.0.2.8"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "服务暂不可用",
    message: "生成配额未正确配置，请联系管理员",
  });
});
