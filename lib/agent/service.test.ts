import assert from "node:assert/strict";
import test from "node:test";

import { GenerationError } from "../generation/service.ts";
import type { GenerateResponse, HookResult, ImageAnalysisResult } from "../types.ts";
import { MemoryAgentRepository } from "./repository.ts";
import {
  AgentInputError,
  AgentProviderError,
  createCreativeCoachService,
  type CoachGenerationRequest,
} from "./service.ts";

const completeBrief = {
  topic: "用 AI 写周报",
  platform: "douyin" as const,
  contentType: "video" as const,
  targetAudience: "产品经理",
  emotionTone: "curious" as const,
  wordLimitBand: "60-80" as const,
  avoidBadcaseTags: [],
};

function hooks(count: number, prefix = "hook"): HookResult[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    text: `${prefix} text ${index}`,
    style: "反差开场",
    reasoning: `具体引用 ${prefix} text ${index} 的表达`,
    scores: { impact: 8, platformFit: 8, actionability: 7, shareability: 7 },
    overallScore: 8,
    badcaseTags: [],
  }));
}

function generated(request: CoachGenerationRequest): GenerateResponse {
  return {
    hooks: hooks(request.count, request.kind),
    generatedAt: "2026-07-18T00:00:00.000Z",
    topic: request.brief.topic,
    platform: request.brief.platform,
    contentType: request.brief.contentType,
    targetAudience: request.brief.targetAudience,
    emotionTone: request.brief.emotionTone,
    wordLimit: 80,
    model: "test-model",
    templateVersion: "test",
    promptVariant: "candidate",
  };
}

function service(overrides: {
  generate?: (request: CoachGenerationRequest) => Promise<GenerateResponse>;
  analyzeImage?: (file: File) => Promise<ImageAnalysisResult>;
  decideBriefPatch?: (input: { message: string; missingField: "topic" | "platform" | "contentType" }) => Promise<Record<string, unknown>>;
} = {}) {
  let sequence = 0;
  return createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    generate: overrides.generate ?? (async (request) => generated(request)),
    analyzeImage: overrides.analyzeImage ?? (async () => ({
      topic: "图片主题",
      imageDescription: "一张没有个人信息的内容截图",
      suggestedPlatform: "xiaohongshu",
      suggestedContentType: "image-text",
      suggestedEmotionTone: "curious",
    })),
    decideBriefPatch: overrides.decideBriefPatch,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    id: (prefix) => `${prefix}-${++sequence}`,
  });
}

test("a complete brief reaches confirmation without an unnecessary clarification", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });

  assert.ok(created.sessionToken);
  assert.equal(created.response.run.status, "awaiting_brief_confirmation");
  assert.equal(created.response.run.clarificationAttempts, 0);
  assert.equal(created.response.needsInput, true);
  assert.deepEqual(created.response.allowedCommands, ["message", "confirm_brief"]);
  assert.doesNotMatch(created.response.messages.map((message) => message.content).join(" "), /missing|缺少/i);
});

test("clarifies one required field at a time and stops after two questions", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: { topic: "AI 周报" } });
  const token = created.sessionToken;
  const runId = created.response.run.id;
  assert.equal(created.response.run.clarificationAttempts, 1);
  assert.match(created.response.messages.at(-1)?.content ?? "", /platform/i);

  const second = await coach.submitTurn(token, runId, 0, { type: "message", text: "douyin" });
  assert.equal(second.run.clarificationAttempts, 2);
  assert.match(second.messages.at(-1)?.content ?? "", /contentType/i);

  const ready = await coach.submitTurn(token, runId, 1, { type: "message", text: "video" });
  assert.equal(ready.run.status, "awaiting_brief_confirmation");
  assert.equal(ready.run.brief?.platform, "douyin");
  assert.equal(ready.run.brief?.contentType, "video");

  const exhausted = await coach.createRun(undefined, { brief: { topic: "另一个主题" } });
  const invalid1 = await coach.submitTurn(exhausted.sessionToken, exhausted.response.run.id, 0, { type: "message", text: "not-a-platform" });
  const invalid2 = await coach.submitTurn(exhausted.sessionToken, exhausted.response.run.id, 1, { type: "message", text: "still-invalid" });
  assert.equal(invalid2.run.requiresFormCompletion, true);
  assert.equal(invalid2.needsInput, true);
  assert.equal(invalid1.run.clarificationAttempts, 2);
  assert.equal(invalid2.run.clarificationAttempts, 2);
});

test("uses a validated low-temperature decision patch for natural-language clarification", async () => {
  let asked = "";
  const coach = service({
    decideBriefPatch: async (input) => { asked = input.missingField; return { platform: "douyin" }; },
  });
  const created = await coach.createRun(undefined, { brief: { topic: "AI 周报", contentType: "video" } });
  const result = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, {
    type: "message", text: "我想发在抖音",
  });
  assert.equal(asked, "platform");
  assert.equal(result.run.status, "awaiting_brief_confirmation");
  assert.equal(result.run.brief?.platform, "douyin");
});

test("generates 10, rewrites one candidate into 3, and regenerates a batch of 10", async () => {
  const calls: CoachGenerationRequest[] = [];
  const coach = service({ generate: async (request) => { calls.push(request); return generated(request); } });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const token = created.sessionToken;
  const runId = created.response.run.id;

  const reviewed = await coach.submitTurn(token, runId, 0, { type: "confirm_brief" });
  assert.equal(reviewed.run.status, "reviewing");
  assert.equal(reviewed.candidates.length, 10);
  assert.equal(reviewed.topCandidates.length, 3);
  assert.deepEqual(calls.map((call) => [call.kind, call.count]), [["initial", 10]]);

  const rewritten = await coach.submitTurn(token, runId, 1, {
    type: "rewrite_candidate",
    candidateId: reviewed.candidates[0]!.id,
    instruction: "更具体",
  });
  assert.equal(rewritten.run.status, "reviewing");
  assert.equal(rewritten.candidates.length, 3);
  assert.equal(rewritten.run.revisionRounds, 1);
  assert.deepEqual(calls.at(-1) && [calls.at(-1)!.kind, calls.at(-1)!.count], ["rewrite", 3]);

  const regenerated = await coach.submitTurn(token, runId, 2, { type: "reject_batch", reason: "太泛" });
  assert.equal(regenerated.candidates.length, 10);
  assert.equal(regenerated.run.revisionRounds, 2);
  assert.deepEqual(calls.at(-1) && [calls.at(-1)!.kind, calls.at(-1)!.count], ["regenerate", 10]);
});

test("enforces the three-revision ceiling and exact candidate counts", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const token = created.sessionToken;
  const runId = created.response.run.id;
  let response = await coach.submitTurn(token, runId, 0, { type: "confirm_brief" });
  for (let round = 0; round < 3; round += 1) {
    response = await coach.submitTurn(token, runId, response.run.revision, {
      type: "rewrite_candidate",
      candidateId: response.candidates[0]!.id,
    });
  }
  await assert.rejects(
    () => coach.submitTurn(token, runId, response.run.revision, { type: "reject_batch", reason: "again" }),
    /Revision round limit/
  );

  const bad = service({ generate: async (request) => ({ ...generated(request), hooks: hooks(request.count - 1) }) });
  const badRun = await bad.createRun(undefined, { brief: completeBrief });
  await assert.rejects(
    () => bad.submitTurn(badRun.sessionToken, badRun.response.run.id, 0, { type: "confirm_brief" }),
    (error: unknown) => error instanceof AgentProviderError && error.response.run.status === "failed"
  );
});

test("requires selection and a separate final confirmation before returning a classic response", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  assert.equal(reviewed.finalizedResponse, undefined);
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, 1, {
    type: "select_candidate",
    candidateId: reviewed.candidates[0]!.id,
  });
  assert.equal(selected.run.status, "awaiting_final_confirmation");
  assert.equal(selected.finalizedResponse, undefined);
  const final = await coach.submitTurn(created.sessionToken, reviewed.run.id, 2, { type: "confirm_final" });
  assert.equal(final.run.status, "completed");
  assert.equal(final.finalizedResponse?.hooks.length, 1);
  assert.equal(final.finalizedResponse?.topic, completeBrief.topic);
});

test("a final-confirmation change request returns to candidate review", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "select_candidate", candidateId: reviewed.candidates[0]!.id,
  });
  const returned = await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, {
    type: "message", text: "再看一下候选",
  });
  assert.equal(returned.run.status, "reviewing");
  assert.equal(returned.pendingConfirmation, null);
});

test("persists recoverable provider failures and retry resumes the interrupted generation", async () => {
  let calls = 0;
  const coach = service({
    generate: async (request) => {
      calls += 1;
      if (calls === 1) throw new GenerationError("timeout");
      return generated(request);
    },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(
    () => coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" }),
    (error: unknown) => error instanceof AgentProviderError && error.status === 504 && error.response.run.resumeStatus === "generating"
  );
  const failed = await coach.getRun(created.sessionToken, created.response.run.id);
  const recovered = await coach.submitTurn(created.sessionToken, created.response.run.id, failed.run.revision, { type: "retry" });
  assert.equal(recovered.run.status, "reviewing");
  assert.equal(recovered.candidates.length, 10);
});

test("analyzes images without storing raw bytes and preserves explicit brief fields", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, {
    brief: { topic: "用户主题", platform: "douyin", contentType: "video" },
    hasImage: true,
  });
  assert.equal(created.response.run.status, "analyzing_image");
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  const analyzed = await coach.uploadImage(created.sessionToken, created.response.run.id, 0, file);
  assert.equal(analyzed.run.status, "awaiting_brief_confirmation");
  assert.equal(analyzed.run.brief?.topic, "用户主题");
  assert.equal(analyzed.run.brief?.platform, "douyin");
  assert.equal(analyzed.run.brief?.imageDescription, "一张没有个人信息的内容截图");
  assert.doesNotMatch(JSON.stringify(analyzed), /data:image|base64|\/9j/i);
});

test("maps an unconfigured image provider to a recoverable service-unavailable failure", async () => {
  const coach = service({ analyzeImage: async () => { throw Object.assign(new Error("not configured"), { status: 501 }); } });
  const created = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  await assert.rejects(
    () => coach.uploadImage(created.sessionToken, created.response.run.id, 0, file),
    (error: unknown) => error instanceof AgentProviderError && error.status === 503 && error.response.run.resumeStatus === "analyzing_image"
  );
});

test("isolates run ownership, revisions, cancellation, and message size", async () => {
  const coach = service();
  const first = await coach.createRun(undefined, { brief: completeBrief });
  const second = await coach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(() => coach.getRun(second.sessionToken, first.response.run.id), /not found/i);
  await assert.rejects(
    () => coach.submitTurn(first.sessionToken, first.response.run.id, 99, { type: "confirm_brief" }),
    /Expected revision/
  );
  await assert.rejects(
    () => coach.submitTurn(first.sessionToken, first.response.run.id, 0, { type: "message", text: "x".repeat(2001) }),
    AgentInputError
  );
  const cancelled = await coach.cancelRun(first.sessionToken, first.response.run.id, 0);
  assert.equal(cancelled.run.status, "cancelled");
});

test("rejects oversized or personal data before it can enter run state", async () => {
  const coach = service();
  await assert.rejects(
    () => coach.createRun(undefined, { brief: { ...completeBrief, topic: "x".repeat(121) } }),
    AgentInputError
  );
  await assert.rejects(
    () => coach.createRun(undefined, { brief: { ...completeBrief, topic: "联系 me@example.com" } }),
    AgentInputError
  );
  await assert.rejects(
    () => coach.createRun(undefined, { brief: { ...completeBrief, hiddenReasoning: "must not persist" } }),
    AgentInputError
  );
  const created = await coach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(
    () => coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "message", text: "手机 13800138000" }),
    AgentInputError
  );
});

test("writes only structured whitelist preferences after final approval and supports delete", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, 1, { type: "select_candidate", candidateId: reviewed.candidates[0]!.id });
  await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  const memory = await coach.getMemory(created.sessionToken);
  assert.ok(memory.entries.some((entry) => entry.key === "default_platform" && entry.value === "douyin"));
  assert.doesNotMatch(JSON.stringify(memory), /AI 周报|hook text|产品经理/);
  const item = memory.entries[0]!;
  await coach.deleteMemory(created.sessionToken, item.id);
  assert.equal((await coach.getMemory(created.sessionToken)).entries.some((entry) => entry.id === item.id), false);
  await coach.clearMemory(created.sessionToken);
  assert.deepEqual((await coach.getMemory(created.sessionToken)).entries, []);
});
