import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { GenerationError } from "../generation/service.ts";
import { generateCoachHooks } from "../generation/coach.ts";
import { collectCoachToolEvents } from "../creativeCoachClient.ts";
import type { GenerateResponse, HookResult, ImageAnalysisResult } from "../types.ts";
import { JsonAgentRepository, MemoryAgentRepository, type AgentRepository } from "./repository.ts";
import {
  AgentInputError,
  AgentProviderError,
  createCreativeCoachService,
  type CoachGenerationRequest,
} from "./service.ts";
import * as coachServiceModule from "./service.ts";
import type { AgentRunStatus, ToolName } from "./types.ts";

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
  generate?: (request: CoachGenerationRequest, options?: { timeoutMs: number }) => Promise<GenerateResponse>;
  analyzeImage?: (file: File) => Promise<ImageAnalysisResult>;
  decideBriefPatch?: (input: { message: string; missingField: "topic" | "platform" | "contentType" }, options?: { timeoutMs: number }) => Promise<Record<string, unknown>>;
  repository?: AgentRepository;
  now?: () => Date;
  operationLeaseMs?: number;
  turnTimeoutMs?: number;
  authorizeTool?: (status: AgentRunStatus, tool: ToolName) => void;
} = {}) {
  let sequence = 0;
  return createCreativeCoachService({
    repository: overrides.repository ?? new MemoryAgentRepository(),
    generate: overrides.generate ?? (async (request) => generated(request)),
    analyzeImage: overrides.analyzeImage ?? (async () => ({
      topic: "图片主题",
      imageDescription: "一张没有个人信息的内容截图",
      suggestedPlatform: "xiaohongshu",
      suggestedContentType: "image-text",
      suggestedEmotionTone: "curious",
    })),
    decideBriefPatch: overrides.decideBriefPatch,
    now: overrides.now ?? (() => new Date("2026-07-18T00:00:00.000Z")),
    operationLeaseMs: overrides.operationLeaseMs,
    turnTimeoutMs: overrides.turnTimeoutMs,
    authorizeTool: overrides.authorizeTool,
    id: (prefix) => `${prefix}-${++sequence}`,
  });
}

test("authorizes every real tool invocation in its fixed execution state", async () => {
  const authorized: Array<[AgentRunStatus, ToolName]> = [];
  const coach = service({ authorizeTool: (status, tool) => authorized.push([status, tool]) });

  const imageRun = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  await coach.uploadImage(imageRun.sessionToken, imageRun.response.run.id, 0, file);

  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const rewritten = await coach.submitTurn(created.sessionToken, created.response.run.id, reviewed.run.revision, { type: "rewrite_candidate", candidateId: reviewed.candidates[0]!.id });
  const regenerated = await coach.submitTurn(created.sessionToken, created.response.run.id, rewritten.run.revision, { type: "reject_batch", reason: "too generic" });
  const selected = await coach.submitTurn(created.sessionToken, created.response.run.id, regenerated.run.revision, { type: "select_candidate", candidateId: regenerated.candidates[0]!.id });
  await coach.submitTurn(created.sessionToken, created.response.run.id, selected.run.revision, { type: "confirm_final" });

  assert.deepEqual(authorized, [
    ["analyzing_image", "analyze_image"],
    ["generating", "generate_hooks"], ["reviewing", "compare_candidates"],
    ["revising", "rewrite_hook"], ["reviewing", "compare_candidates"],
    ["revising", "regenerate_batch"], ["reviewing", "compare_candidates"],
    ["awaiting_final_confirmation", "save_final_choice"],
  ]);
});

test("authorization denial rolls back the reservation and never invokes an external provider", async () => {
  let imageCalls = 0;
  const imageCoach = service({
    analyzeImage: async () => { imageCalls += 1; throw new Error("must not execute"); },
    authorizeTool: (_status, tool) => { if (tool === "analyze_image") throw new Error("denied"); },
  });
  const imageRun = await imageCoach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  await assert.rejects(() => imageCoach.uploadImage(imageRun.sessionToken, imageRun.response.run.id, 0, file), /denied/);
  assert.equal(imageCalls, 0);
  assert.equal((await imageCoach.getRun(imageRun.sessionToken, imageRun.response.run.id)).run.revision, 0);

  let generationCalls = 0;
  const generationCoach = service({
    generate: async (request) => { generationCalls += 1; return generated(request); },
    authorizeTool: (_status, tool) => { if (tool === "generate_hooks") throw new Error("denied"); },
  });
  const created = await generationCoach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(() => generationCoach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" }), /denied/);
  assert.equal(generationCalls, 0);
  const unchanged = await generationCoach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(unchanged.run.status, "awaiting_brief_confirmation");
  assert.equal(unchanged.run.revision, 0);
});

test("compare preauthorization denial prevents generation and leaves no reservation artifacts", async () => {
  let providerCalls = 0;
  const coach = service({
    generate: async (request) => { providerCalls += 1; return generated(request); },
    authorizeTool: (_status, tool) => { if (tool === "compare_candidates") throw new Error("compare denied"); },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(() => coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" }), /compare denied/);
  assert.equal(providerCalls, 0);
  const unchanged = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(unchanged.run.status, "awaiting_brief_confirmation");
  assert.equal(unchanged.run.revision, 0);
  assert.equal(unchanged.run.activeOperation, undefined);
  assert.equal(unchanged.run.toolCalls.length, 0);
});

test("corrupted illegal public states cannot reach image or generation providers", async () => {
  const repository = new MemoryAgentRepository();
  let imageCalls = 0;
  let generationCalls = 0;
  const coach = service({
    repository,
    analyzeImage: async () => { imageCalls += 1; throw new Error("must not execute"); },
    generate: async (request) => { generationCalls += 1; return generated(request); },
  });
  const imageRun = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  await repository.transaction((state) => { state.runs.find((run) => run.id === imageRun.response.run.id)!.status = "understanding"; });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  await assert.rejects(() => coach.uploadImage(imageRun.sessionToken, imageRun.response.run.id, 0, file), /not expected/);

  const generationRun = await coach.createRun(undefined, { brief: completeBrief });
  await repository.transaction((state) => { state.runs.find((run) => run.id === generationRun.response.run.id)!.status = "understanding"; });
  await assert.rejects(() => coach.submitTurn(generationRun.sessionToken, generationRun.response.run.id, 0, { type: "confirm_brief" }), /not allowed/);
  assert.equal(imageCalls, 0);
  assert.equal(generationCalls, 0);
});

test("recovers one expired generation lease atomically and rejects the old result", async () => {
  let currentTime = new Date("2026-07-18T00:00:00.000Z");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({
    now: () => currentTime,
    operationLeaseMs: 1_000,
    generate: async (request) => { await gate; return generated(request); },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const original = coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" })
    .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await new Promise((resolve) => setTimeout(resolve, 5));

  const active = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(active.run.revision, 1);
  assert.ok(active.run.activeOperation?.expiresAt);
  currentTime = new Date("2026-07-18T00:00:01.001Z");
  const staleTurn = coach.submitTurn(created.sessionToken, created.response.run.id, 1, { type: "confirm_brief" })
    .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  const recovered = await Promise.all(Array.from({ length: 6 }, () => coach.getRun(created.sessionToken, created.response.run.id)));
  const conflict = await staleTurn;

  assert.equal(conflict.ok, false);
  assert.match(String(conflict.ok ? "" : conflict.error), /Expected revision/);
  assert.ok(recovered.every((response) => response.run.revision === 2));
  assert.ok(recovered.every((response) => response.run.status === "failed"));
  assert.deepEqual(recovered[0]!.allowedCommands, ["retry"]);
  const expired = recovered[0]!.run.toolResults.filter((result) => result.error?.code === "operation_expired");
  assert.equal(expired.length, 1);
  assert.equal(expired[0]!.callId, recovered[0]!.run.toolCalls[0]!.id);

  release();
  const oldResult = await original;
  assert.equal(oldResult.ok, false);
  const final = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(final.run.toolResults.filter((result) => result.error?.code === "operation_expired").length, 1);
  assert.equal(final.candidates.length, 0);
});

test("recovers an expired decision without persisting the abandoned user message", async () => {
  let currentTime = new Date("2026-07-18T00:00:00.000Z");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({
    now: () => currentTime,
    operationLeaseMs: 1_000,
    decideBriefPatch: async () => { await gate; return { platform: "douyin" }; },
  });
  const created = await coach.createRun(undefined, { brief: { topic: "AI report", contentType: "video" } });
  const original = coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "message", text: "post it there" })
    .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  currentTime = new Date("2026-07-18T00:00:01.001Z");

  const recovered = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(recovered.run.status, "understanding");
  assert.equal(recovered.run.revision, 2);
  assert.equal(recovered.run.activeOperation, undefined);
  assert.equal(recovered.run.messages.some((message) => message.content === "post it there"), false);
  assert.deepEqual(recovered.allowedCommands, ["message"]);

  release();
  assert.equal((await original).ok, false);
});

test("recovers an expired image lease and retry explicitly requests a re-upload", async () => {
  let currentTime = new Date("2026-07-18T00:00:00.000Z");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({
    now: () => currentTime,
    operationLeaseMs: 1_000,
    analyzeImage: async () => { await gate; return {
      topic: "image", imageDescription: "safe image", suggestedPlatform: "douyin", suggestedContentType: "video", suggestedEmotionTone: "curious",
    }; },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  const original = coach.uploadImage(created.sessionToken, created.response.run.id, 0, file)
    .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  currentTime = new Date("2026-07-18T00:00:01.001Z");

  const recovered = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(recovered.run.status, "failed");
  assert.equal(recovered.run.resumeStatus, "analyzing_image");
  assert.equal(recovered.run.toolResults.at(-1)?.error?.code, "operation_expired");
  const retry = await coach.submitTurn(created.sessionToken, created.response.run.id, recovered.run.revision, { type: "retry" });
  assert.equal(retry.run.status, "analyzing_image");
  assert.equal(retry.needsInput, true);

  release();
  assert.equal((await original).ok, false);
  const reuploaded = await coach.uploadImage(created.sessionToken, created.response.run.id, retry.run.revision, file);
  assert.equal(reuploaded.run.status, "awaiting_brief_confirmation");
});

test("recovers a legacy startedAt-only lease after JSON repository restart and persists it once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-lease-"));
  const file = path.join(directory, "agent.json");
  const repository = new JsonAgentRepository(file);
  const first = service({ repository, now: () => new Date("2026-07-19T00:00:00.000Z"), operationLeaseMs: 1_000 });
  const created = await first.createRun(undefined, { brief: completeBrief });
  await repository.transaction((state) => {
    const run = state.runs.find((item) => item.id === created.response.run.id)!;
    run.status = "generating";
    run.revision = 7;
    run.pendingGeneration = { kind: "initial", count: 10 };
    run.activeOperation = { id: "operation-from-dead-process", kind: "generation", startedAt: "2020-01-01T00:00:00.000Z" };
    run.toolCalls.push({ id: "call-from-dead-process", tool: "generate_hooks", input: { expectedCount: 10 }, status: "requested", createdAt: "2020-01-01T00:00:00.000Z" });
  });

  const restarted = service({
    repository: new JsonAgentRepository(file),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    operationLeaseMs: 1_000,
  });
  const responses = await Promise.all(Array.from({ length: 4 }, () => restarted.getRun(created.sessionToken, created.response.run.id)));
  assert.ok(responses.every((response) => response.run.revision === 8));
  assert.equal(responses[0]!.run.toolResults.filter((result) => result.error?.code === "operation_expired").length, 1);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.runs[0].revision, 8);
  assert.equal(persisted.runs[0].summary.status, "failed");
  assert.equal(persisted.runs[0].toolResults.filter((result: { error?: { code?: string } }) => result.error?.code === "operation_expired").length, 1);
});

test("keeps a non-expired lease locked while allowing explicit cancellation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({
    operationLeaseMs: 60_000,
    generate: async (request) => { await gate; return generated(request); },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const original = coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" })
    .then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const active = await coach.getRun(created.sessionToken, created.response.run.id);
  await assert.rejects(
    () => coach.submitTurn(created.sessionToken, created.response.run.id, active.run.revision, { type: "confirm_brief" }),
    /in flight/,
  );
  const cancelled = await coach.cancelRun(created.sessionToken, created.response.run.id, active.run.revision);
  assert.equal(cancelled.run.status, "cancelled");
  release();
  assert.equal((await original).ok, false);
});

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
  const structured = await coach.submitTurn(exhausted.sessionToken, exhausted.response.run.id, invalid2.run.revision, {
    type: "message",
    text: JSON.stringify({ topic: "完整主题", platform: "douyin", contentType: "video", emotionTone: "curious", wordLimitBand: "60-80" }),
  });
  assert.equal(structured.run.status, "awaiting_brief_confirmation");
  assert.equal(structured.run.requiresFormCompletion, false);
  assert.equal(structured.run.brief?.platform, "douyin");
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

test("atomically reserves one decision call for concurrent stale turns", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({ decideBriefPatch: async () => { calls += 1; await gate; return { platform: "douyin" }; } });
  const created = await coach.createRun(undefined, { brief: { topic: "AI 周报", contentType: "video" } });
  const attempts = Array.from({ length: 8 }, () => coach.submitTurn(
    created.sessionToken, created.response.run.id, 0, { type: "message", text: "我想发在抖音" }
  ).then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason })));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const callsBeforeRelease = calls;
  let mid;
  try { mid = await coach.getRun(created.sessionToken, created.response.run.id); }
  finally { release(); }
  const settled = await Promise.all(attempts);
  assert.equal(callsBeforeRelease, 1);
  assert.equal(mid.allowedCommands.length, 0);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected" && /Expected revision/.test(String(item.reason))).length, 7);
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
  const generationResult = reviewed.run.toolResults.find((item) => item.tool === "generate_hooks" && item.status === "success");
  assert.deepEqual(generationResult?.output, { count: 10, modelCalls: 1, formatAndCountRetries: 0 });
  assert.deepEqual(calls.map((call) => [call.kind, call.count]), [["initial", 10]]);

  const rewritten = await coach.submitTurn(token, runId, reviewed.run.revision, {
    type: "rewrite_candidate",
    candidateId: reviewed.candidates[0]!.id,
    instruction: "更具体",
  });
  assert.equal(rewritten.run.status, "reviewing");
  assert.equal(rewritten.candidates.length, 3);
  assert.equal(rewritten.run.revisionRounds, 1);
  assert.deepEqual(calls.at(-1) && [calls.at(-1)!.kind, calls.at(-1)!.count], ["rewrite", 3]);

  const regenerated = await coach.submitTurn(token, runId, rewritten.run.revision, { type: "reject_batch", reason: "太泛" });
  assert.equal(regenerated.candidates.length, 10);
  assert.equal(regenerated.run.revisionRounds, 2);
  assert.deepEqual(calls.at(-1) && [calls.at(-1)!.kind, calls.at(-1)!.count], ["regenerate", 10]);
});

test("atomically reserves one generation and invalidates the mid-operation revision", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({ generate: async (request) => { calls += 1; await gate; return generated(request); } });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const attempts = Array.from({ length: 8 }, () => coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" })
    .then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason })));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const callsBeforeRelease = calls;
  let mid;
  try { mid = await coach.getRun(created.sessionToken, created.response.run.id); }
  finally { release(); }
  const settled = await Promise.all(attempts);
  assert.equal(callsBeforeRelease, 1);
  assert.equal(mid.run.status, "generating");
  assert.equal(mid.run.revision, 1);
  assert.deepEqual(mid.run.activeOperation?.budgetReservation, { steps: 1, modelCalls: 2, generationCalls: 1, formatAndCountRetries: 1 });
  assert.equal(mid.allowedCommands.length, 0);
  const successful = settled.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof coach.submitTurn>>> => item.status === "fulfilled")!;
  assert.equal(successful.value.run.revision, 2);
  await assert.rejects(() => coach.submitTurn(created.sessionToken, created.response.run.id, 1, { type: "select_candidate", candidateId: successful.value.candidates[0]!.id }), /Expected revision/);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 7);
});

test("a revising operation blocks selection and another revision at its current revision", async () => {
  let release!: () => void;
  const rewriteGate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({ generate: async (request) => {
    if (request.kind === "rewrite") await rewriteGate;
    return generated(request);
  } });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const rewriting = coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "rewrite_candidate", candidateId: reviewed.candidates[0]!.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const mid = await coach.getRun(created.sessionToken, reviewed.run.id);
  assert.equal(mid.run.status, "revising");
  assert.deepEqual(mid.allowedCommands, []);
  await assert.rejects(
    () => coach.submitTurn(created.sessionToken, reviewed.run.id, mid.run.revision, { type: "select_candidate", candidateId: reviewed.candidates[0]!.id }),
    /in flight/
  );
  release();
  await rewriting;
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
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "select_candidate",
    candidateId: reviewed.candidates[0]!.id,
  });
  assert.equal(selected.run.status, "awaiting_final_confirmation");
  assert.equal(selected.finalizedResponse, undefined);
  const final = await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  assert.equal(final.run.status, "completed");
  assert.equal(final.finalizedResponse?.hooks.length, 1);
  assert.equal(final.finalizedResponse?.topic, completeBrief.topic);
});

test("rebuilds the finalized response from a completed run after the confirmation response is lost", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "select_candidate", candidateId: reviewed.candidates[0]!.id,
  });
  await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });

  const recovered = await coach.getRun(created.sessionToken, reviewed.run.id);
  assert.equal(recovered.run.status, "completed");
  assert.equal(recovered.finalizedResponse?.taskId, reviewed.run.id);
  assert.equal(recovered.finalizedResponse?.hooks[0]?.id, reviewed.candidates[0]!.id);
  assert.equal(recovered.finalizedResponse?.generatedAt, recovered.run.finalizedAt);
});

test("recovers a legacy completed run without finalizedAt from memory and fails closed on invalid legacy metadata", async () => {
  const repository = new MemoryAgentRepository();
  const coach = service({ repository });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "select_candidate", candidateId: reviewed.candidates[0]!.id,
  });
  await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  await repository.transaction((state) => { delete state.runs[0]!.finalizedAt; });

  const recovered = await coach.getRun(created.sessionToken, reviewed.run.id);
  assert.equal(recovered.finalizedResponse?.generatedAt, recovered.run.updatedAt);
  assert.equal(recovered.finalizedResponse?.taskId, reviewed.run.id);

  await repository.transaction((state) => { state.runs[0]!.updatedAt = "2026-07-19T00:00:00.000Z"; });
  assert.equal((await coach.getRun(created.sessionToken, reviewed.run.id)).finalizedResponse?.generatedAt, "2026-07-19T00:00:00.000Z");
  for (const invalidTimestamp of [
    "2026-02-31T00:00:00.000Z",
    "0",
    "07/19/2026",
    "2026-07-19T08:00:00+08:00",
    "invalid",
    0,
  ]) {
    await repository.transaction((state) => {
      state.runs[0]!.finalizedAt = invalidTimestamp as string;
    });
    assert.equal((await coach.getRun(created.sessionToken, reviewed.run.id)).finalizedResponse, undefined);
  }
  await repository.transaction((state) => {
    delete state.runs[0]!.finalizedAt;
    state.runs[0]!.updatedAt = "2026-07-18T00:00:00.000Z";
    state.runs[0]!.candidates = [];
  });
  assert.equal((await coach.getRun(created.sessionToken, reviewed.run.id)).finalizedResponse, undefined);
});

test("accepts only canonical toISOString timestamps", () => {
  const isCanonicalIsoTimestamp = (coachServiceModule as unknown as {
    isCanonicalIsoTimestamp?: (value: unknown) => boolean;
  }).isCanonicalIsoTimestamp;
  assert.equal(typeof isCanonicalIsoTimestamp, "function");
  assert.equal(isCanonicalIsoTimestamp!("2026-07-19T00:00:00.000Z"), true);
  for (const value of [
    "2026-02-31T00:00:00.000Z",
    "0",
    "07/19/2026",
    "2026-07-19T08:00:00+08:00",
    "invalid",
    0,
    null,
  ]) assert.equal(isCanonicalIsoTimestamp!(value), false);
});

test("recovers finalizedResponse when a JSON legacy completed run is loaded without finalizedAt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-legacy-finalized-"));
  const file = path.join(directory, "agent-store.json");
  try {
    const firstRepository = new JsonAgentRepository(file);
    const firstCoach = service({ repository: firstRepository });
    const created = await firstCoach.createRun(undefined, { brief: completeBrief });
    const reviewed = await firstCoach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
    const selected = await firstCoach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
      type: "select_candidate", candidateId: reviewed.candidates[0]!.id,
    });
    await firstCoach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
    await firstRepository.transaction((state) => { delete state.runs[0]!.finalizedAt; });

    const restartedCoach = service({ repository: new JsonAgentRepository(file) });
    const recovered = await restartedCoach.getRun(created.sessionToken, reviewed.run.id);
    assert.equal(recovered.finalizedResponse?.generatedAt, recovered.run.updatedAt);
    assert.equal(recovered.finalizedResponse?.hooks[0]?.id, reviewed.candidates[0]!.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a double final confirmation writes once and the stale confirmation recovers the same final", async () => {
  const coach = service();
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, {
    type: "select_candidate", candidateId: reviewed.candidates[0]!.id,
  });
  await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  await assert.rejects(
    () => coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" }),
    /Expected revision/,
  );
  const recovered = await coach.getRun(created.sessionToken, reviewed.run.id);
  assert.equal(recovered.run.toolCalls.filter((call) => call.tool === "save_final_choice").length, 1);
  assert.equal(recovered.finalizedResponse?.taskId, reviewed.run.id);
});

test("applies an edited image description before confirmed generation", async () => {
  let generationRequest: CoachGenerationRequest | undefined;
  const coach = service({ generate: async (request) => {
    generationRequest = request;
    return generated(request);
  } });
  const created = await coach.createRun(undefined, { brief: { ...completeBrief, imageDescription: "原始图片理解" } });
  await coach.submitTurn(created.sessionToken, created.response.run.id, 0, {
    type: "confirm_brief",
    briefPatch: { imageDescription: "用户修正后的图片理解" },
  } as never);

  assert.equal(generationRequest?.brief.imageDescription, "用户修正后的图片理解");
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
  let providerFailure: AgentProviderError | undefined;
  try {
    await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  } catch (error) {
    if (error instanceof AgentProviderError) providerFailure = error;
  }
  assert.equal(providerFailure?.status, 504);
  assert.equal(providerFailure?.response.run.resumeStatus, "generating");
  assert.deepEqual(collectCoachToolEvents(providerFailure!.response, new Set()).map((event) => event.status), ["error"]);
  const failed = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(calls, 1);
  assert.equal(failed.run.status, "failed");
  assert.equal(failed.run.revision, 2);
  assert.deepEqual(failed.allowedCommands, ["retry"]);
  assert.equal(failed.needsInput, true);
  const recovered = await coach.submitTurn(created.sessionToken, created.response.run.id, failed.run.revision, { type: "retry" });
  assert.equal(recovered.run.status, "reviewing");
  assert.equal(recovered.run.revision, 4);
  assert.equal(recovered.candidates.length, 10);
  assert.equal(calls, 2);
});

test("bounds a hanging coach repair and persists a recoverable generation failure immediately", async () => {
  let attempts = 0;
  let forwardedTimeoutMs: number | undefined;
  const provider = {
    async generate() {
      attempts += 1;
      if (attempts === 1) return { hooks: [] };
      return new Promise<never>(() => undefined);
    },
  };
  const coach = service({
    turnTimeoutMs: 20,
    generate: async (request, options) => {
      forwardedTimeoutMs = options?.timeoutMs;
      return generateCoachHooks(request, {
        provider,
        timeoutMs: options?.timeoutMs ?? 20,
      });
    },
  });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  let failure: AgentProviderError | undefined;

  try {
    await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  } catch (error) {
    if (error instanceof AgentProviderError) failure = error;
  }

  const persisted = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(failure?.causeCode, "timeout");
  assert.equal(attempts, 2);
  assert.ok(forwardedTimeoutMs !== undefined && forwardedTimeoutMs > 0 && forwardedTimeoutMs <= 20);
  assert.equal(persisted.run.status, "failed");
  assert.equal(persisted.run.recoverable, true);
  assert.equal(persisted.run.resumeStatus, "generating");
  assert.equal(persisted.run.activeOperation, undefined);
});

test("bounds a hanging decision call and completes deterministic fallback through CAS", async () => {
  let forwardedTimeoutMs: number | undefined;
  const coach = service({
    turnTimeoutMs: 15,
    decideBriefPatch: async (_request, options) => {
      forwardedTimeoutMs = options?.timeoutMs;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { platform: "douyin" };
    },
  });
  const created = await coach.createRun(undefined, {
    brief: { topic: "AI weekly report", contentType: "video" },
  });
  const startedAt = performance.now();

  const response = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, {
    type: "message",
    text: "not a platform",
  });
  const persisted = await coach.getRun(created.sessionToken, created.response.run.id);

  assert.ok(performance.now() - startedAt < 50);
  assert.ok(forwardedTimeoutMs !== undefined && forwardedTimeoutMs > 0 && forwardedTimeoutMs <= 15);
  assert.equal(response.run.status, "understanding");
  assert.equal(response.run.activeOperation, undefined);
  assert.equal(persisted.run.activeOperation, undefined);
  assert.equal(persisted.run.revision, response.run.revision);
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

test("atomically reserves one image call and validates upload before reservation", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const coach = service({ analyzeImage: async () => { calls += 1; await gate; return {
    topic: "图", imageDescription: "安全图片描述", suggestedPlatform: "douyin", suggestedContentType: "video", suggestedEmotionTone: "curious",
  }; } });
  const created = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const invalid = new File([], "empty.png", { type: "image/png" });
  await assert.rejects(() => coach.uploadImage(created.sessionToken, created.response.run.id, 0, invalid), /包含内容|empty/i);
  assert.equal((await coach.getRun(created.sessionToken, created.response.run.id)).run.revision, 0);
  assert.equal(calls, 0);

  const valid = new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" });
  const attempts = Array.from({ length: 5 }, () => coach.uploadImage(created.sessionToken, created.response.run.id, 0, valid)
    .then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason })));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const callsBeforeRelease = calls;
  let mid;
  try { mid = await coach.getRun(created.sessionToken, created.response.run.id); }
  finally { release(); }
  const settled = await Promise.all(attempts);
  assert.equal(callsBeforeRelease, 1);
  assert.equal(mid.run.revision, 1);
  assert.equal(mid.needsInput, false);
  const success = settled.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof coach.uploadImage>>> => item.status === "fulfilled")!;
  assert.equal(success.value.run.revision, 2);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 4);
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
  const selected = await coach.submitTurn(created.sessionToken, reviewed.run.id, reviewed.run.revision, { type: "select_candidate", candidateId: reviewed.candidates[0]!.id });
  await coach.submitTurn(created.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  const completed = await coach.getRun(created.sessionToken, reviewed.run.id);
  assert.equal(completed.run.approvals.length, 1);
  assert.equal(completed.run.approvals[0]?.status, "approved");
  assert.equal(completed.run.approvals[0]?.tool, "save_final_choice");
  const saveCall = completed.run.toolCalls.find((item) => item.tool === "save_final_choice")!;
  assert.equal(completed.run.toolResults.find((item) => item.callId === saveCall.id)?.status, "success");
  const memory = await coach.getMemory(created.sessionToken);
  assert.ok(memory.entries.some((entry) => entry.key === "default_platform" && entry.value === "douyin"));
  assert.doesNotMatch(JSON.stringify(memory), /AI 周报|hook text|产品经理/);
  const item = memory.entries[0]!;
  await coach.deleteMemory(created.sessionToken, item.id);
  assert.equal((await coach.getMemory(created.sessionToken)).entries.some((entry) => entry.id === item.id), false);
  await coach.clearMemory(created.sessionToken);
  assert.deepEqual((await coach.getMemory(created.sessionToken)).entries, []);
});

test("explicit empty avoid tags override remembered tags and summaries stay current", async () => {
  const coach = service();
  const first = await coach.createRun(undefined, { brief: { ...completeBrief, avoidBadcaseTags: ["too_long"] } });
  const reviewed = await coach.submitTurn(first.sessionToken, first.response.run.id, 0, { type: "confirm_brief" });
  const selected = await coach.submitTurn(first.sessionToken, reviewed.run.id, reviewed.run.revision, { type: "select_candidate", candidateId: reviewed.candidates[0]!.id });
  await coach.submitTurn(first.sessionToken, reviewed.run.id, selected.run.revision, { type: "confirm_final" });
  const remembered = await coach.createRun(first.sessionToken, { brief: { topic: "memory", contentType: "video" } });
  assert.equal(remembered.response.run.brief?.platform, "douyin");
  assert.ok(remembered.response.run.appliedMemoryKeys?.includes("default_platform"));
  assert.ok(remembered.response.run.appliedMemoryKeys?.includes("preferred_tone"));
  assert.ok(remembered.response.run.appliedMemoryKeys?.includes("word_limit_band"));
  assert.ok(remembered.response.run.appliedMemoryKeys?.includes("avoid_badcase_tag"));
  const second = await coach.createRun(first.sessionToken, { brief: { ...completeBrief, avoidBadcaseTags: [] } });
  assert.deepEqual(second.response.run.brief?.avoidBadcaseTags, []);
  assert.equal(second.response.run.appliedMemoryKeys?.includes("avoid_badcase_tag"), false);
  assert.equal(second.response.run.summary.status, second.response.run.status);
  assert.equal(second.response.run.summary.candidateCount, second.response.run.candidates.length);
});
