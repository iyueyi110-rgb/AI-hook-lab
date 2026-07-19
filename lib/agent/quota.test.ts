import assert from "node:assert/strict";
import test from "node:test";

import { MemoryAgentRepository, createCreatorSession, createInitialAgentState } from "./repository.ts";
import { AgentProviderError, createCreativeCoachService } from "./service.ts";
import {
  AgentQuotaError,
  consumeAgentQuota,
  type AgentQuotaConfig,
} from "./quota.ts";

const config: AgentQuotaConfig = {
  windowMs: 1_000,
  sessionRunCreates: 2,
  ipRunCreates: 2,
  sessionModelCalls: 2,
  ipModelCalls: 2,
  sessionImageCalls: 1,
  ipImageCalls: 1,
  maxActiveRunsPerSession: 3,
};
const ipDigest = "a".repeat(64);

test("quota is shared by new sessions on the same hashed IP and resets with its window", () => {
  const state = createInitialAgentState();
  const first = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  const second = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  consumeAgentQuota(state, first, { ipDigest }, "run_create", new Date("2026-01-01T00:00:00.000Z"), config);
  consumeAgentQuota(state, second, { ipDigest }, "run_create", new Date("2026-01-01T00:00:00.100Z"), config);
  const third = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  assert.throws(() => consumeAgentQuota(state, third, { ipDigest }, "run_create", new Date("2026-01-01T00:00:00.200Z"), config), AgentQuotaError);
  consumeAgentQuota(state, third, { ipDigest }, "run_create", new Date("2026-01-01T00:00:01.001Z"), config);
});

test("quota checks all scopes before incrementing and rejects malformed IP digests", () => {
  const state = createInitialAgentState();
  const session = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  consumeAgentQuota(state, session, { ipDigest }, "image_call", new Date("2026-01-01T00:00:00.000Z"), config);
  const before = structuredClone(state.usage);
  assert.throws(() => consumeAgentQuota(state, session, { ipDigest }, "image_call", new Date("2026-01-01T00:00:00.100Z"), config), AgentQuotaError);
  assert.deepEqual(state.usage, before);
  assert.throws(() => consumeAgentQuota(state, session, { ipDigest: "raw-client-address" }, "model_call", new Date(), config), AgentQuotaError);
  assert.equal(JSON.stringify(state).includes("raw-client-address"), false);
});

test("active run quota blocks unbounded anonymous state", () => {
  const state = createInitialAgentState();
  const session = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  state.runs.push(...Array.from({ length: 3 }, (_, index) => ({
    id: `run-${index}`, creatorSessionId: session.id, revision: 0, status: "reviewing" as const,
    messages: [], candidates: [], toolCalls: [], toolResults: [], approvals: [], memory: { entries: [] }, revisionRounds: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    summary: { messageCount: 0, candidateCount: 0, status: "reviewing" as const },
  })));
  assert.throws(() => consumeAgentQuota(state, session, { ipDigest }, "run_create", new Date("2026-01-01T00:00:00.000Z"), config), AgentQuotaError);
  assert.equal(state.usage?.length, 0);
});

test("repository transactions enforce concurrent IP limits across rotated sessions", async () => {
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    generate: async () => { throw new Error("not used"); },
    analyzeImage: async () => { throw new Error("not used"); },
    quotaConfig: { ...config, sessionRunCreates: 5, ipRunCreates: 2, maxActiveRunsPerSession: 5 },
  });
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => service.createRun(undefined, {
    brief: { topic: "quota", platform: "douyin", contentType: "video" },
  }, { ipDigest })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 2);
  assert.equal(attempts.filter((item) => item.status === "rejected" && item.reason instanceof AgentQuotaError).length, 3);
});

test("provider failures consume reserved model quota while validation rejections do not", async () => {
  let providerCalls = 0;
  const repository = new MemoryAgentRepository();
  const service = createCreativeCoachService({
    repository,
    generate: async () => { providerCalls += 1; throw new Error("provider down"); },
    analyzeImage: async () => { throw new Error("not used"); },
    quotaConfig: { ...config, sessionModelCalls: 4, ipModelCalls: 4, sessionRunCreates: 5, ipRunCreates: 5 },
  });
  const created = await service.createRun(undefined, { brief: { topic: "quota", platform: "douyin", contentType: "video" } }, { ipDigest });
  await assert.rejects(service.submitTurn(created.sessionToken, created.response.run.id, 99, { type: "confirm_brief" }, { ipDigest }));
  assert.equal((await repository.read()).usage?.filter((item) => item.kind === "model_call").length, 0);
  await assert.rejects(service.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" }, { ipDigest }), AgentProviderError);
  await assert.rejects(service.submitTurn(created.sessionToken, created.response.run.id, 2, { type: "retry" }, { ipDigest }), AgentProviderError);
  await assert.rejects(service.submitTurn(created.sessionToken, created.response.run.id, 4, { type: "retry" }, { ipDigest }), AgentQuotaError);
  assert.equal(providerCalls, 2);
});
