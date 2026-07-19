import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { GenerateResponse, HookResult, ImageAnalysisResult } from "../types.ts";
import { validateDashboardPayload } from "../dashboardStore.ts";
import { EVALUATION_CASES } from "../evaluation/seeds.ts";
import { generateCoachHooks } from "../generation/coach.ts";
import type { GenerationProvider } from "../generation/service.ts";
import { MemoryAgentRepository } from "./repository.ts";
import { createCreativeCoachService, type CoachGenerationRequest } from "./service.ts";
import { assertToolAllowed } from "./tools.ts";
import type { AgentRunStatus, ToolName } from "./types.ts";
import {
  AGENT_EVAL_THRESHOLDS,
  AGENT_HUMAN_PAIRWISE_PROTOCOL,
  AGENT_OBJECTIVE_RUBRIC,
  evaluateAgentOfflineResults,
  shouldContinueAgentOptimization,
  type AgentOfflineObservation,
} from "./evaluation.ts";

const completeBrief = {
  topic: "AI weekly report",
  platform: "douyin" as const,
  contentType: "video" as const,
  targetAudience: "product managers",
  emotionTone: "curious" as const,
  wordLimitBand: "60-80" as const,
  avoidBadcaseTags: [],
};

function hooks(count: number, prefix = "hook"): HookResult[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    text: `${prefix} text ${index}`,
    style: "contrast",
    reasoning: `Evidence from ${prefix} text ${index}`,
    scores: { impact: 8, platformFit: 8, actionability: 7, shareability: 7 },
    overallScore: 8,
    badcaseTags: [],
  }));
}

function generated(request: CoachGenerationRequest): GenerateResponse {
  return {
    hooks: hooks(request.count, request.kind),
    generatedAt: "2026-07-19T00:00:00.000Z",
    topic: request.brief.topic,
    platform: request.brief.platform,
    contentType: request.brief.contentType,
    targetAudience: request.brief.targetAudience,
    emotionTone: request.brief.emotionTone,
    wordLimit: 80,
    model: "offline-fixture",
    templateVersion: "agent-eval",
    promptVariant: "candidate",
  };
}

function createService(repository = new MemoryAgentRepository(), overrides: {
  generate?: (request: CoachGenerationRequest) => Promise<GenerateResponse>;
  analyzeImage?: (file: File) => Promise<ImageAnalysisResult>;
} = {}) {
  let sequence = 0;
  return createCreativeCoachService({
    repository,
    generate: overrides.generate ?? (async (request) => generated(request)),
    analyzeImage: overrides.analyzeImage ?? (async () => ({
      topic: "image topic",
      imageDescription: "A safe product screenshot without personal information.",
      suggestedPlatform: "douyin",
      suggestedContentType: "video",
      suggestedEmotionTone: "curious",
    })),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    id: (prefix) => `${prefix}-${++sequence}`,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function corpusHash(cases: typeof EVALUATION_CASES): string {
  return createHash("sha256").update(stableJson(cases)).digest("hex");
}

test("agent evaluation inventory covers every approved coach scenario without changing the legacy 60-case corpus", async () => {
  const inventory = JSON.parse(await readFile(new URL("../../eval/agent-fixtures.json", import.meta.url), "utf8")) as {
    scenarios: Array<{ id: string; evaluation: string; evidenceTest: string; includedInMachineMetrics: boolean }>;
  };
  assert.equal(EVALUATION_CASES.length, 60);
  assert.equal(new Set(EVALUATION_CASES.map((item) => item.caseId)).size, 60);
  assert.equal(EVALUATION_CASES[0]?.caseId, "CASE_001_XHS");
  assert.equal(EVALUATION_CASES.at(-1)?.caseId, "CASE_020_BILI");
  assert.deepEqual(Object.keys(EVALUATION_CASES[0]!).sort(), [
    "caseId", "category", "createdAt", "dataOrigin", "datasetVersion", "emotionStyle", "id",
    "lengthLimit", "platform", "platformLabel", "status", "targetAudience", "topic", "topicId", "updatedAt",
  ]);
  assert.equal(corpusHash(EVALUATION_CASES), "67987ce48299cbaf60e54695aac2c84791cbdbadec408b1d8b7ae31f110fff6b");
  const mutated = structuredClone(EVALUATION_CASES);
  mutated[0]!.datasetVersion = `${mutated[0]!.datasetVersion}-mutated`;
  assert.notEqual(corpusHash(mutated), corpusHash(EVALUATION_CASES));
  assert.deepEqual(new Set(inventory.scenarios.map((item) => item.id)), new Set([
    "complete_brief", "missing_topic", "missing_platform", "missing_content_type",
    "image_confirm_and_correct", "initial_ten", "rewrite_three", "regenerate_ten",
    "three_revision_stop", "one_format_repair", "non_improving_stop", "refresh_recovery",
    "revision_conflict", "approval_bypass", "cross_session", "provider_error_retry",
    "memory_current_request_override", "memory_delete", "hook_quality_and_top3_explanation",
  ]));
  assert.ok(inventory.scenarios.every((item) => ["deterministic", "human_pairwise"].includes(item.evaluation)));
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: { "eval:agent": string } };
  const executedTestSources = await Promise.all([
    ["lib/agent/evaluation.test.ts", new URL("./evaluation.test.ts", import.meta.url)] as const,
    ["lib/agent/service.test.ts", new URL("./service.test.ts", import.meta.url)] as const,
    ["lib/generation/service.test.ts", new URL("../generation/service.test.ts", import.meta.url)] as const,
  ].map(async ([file, url]) => ({ file, source: await readFile(url, "utf8") })));
  for (const scenario of inventory.scenarios) {
    if (scenario.evaluation === "deterministic") {
      assert.equal(scenario.includedInMachineMetrics, true);
      const evidence = executedTestSources.find((item) => item.source.includes(`test(\"${scenario.evidenceTest}\"`));
      assert.ok(evidence, `${scenario.id} must map to an executable test`);
      assert.ok(packageJson.scripts["eval:agent"].includes(evidence.file), `${scenario.id} evidence must run in eval:agent`);
    } else {
      assert.equal(scenario.includedInMachineMetrics, false);
    }
  }
});

test("shared generation repairs invalid JSON or count once per Agent turn and exposes final success or failure", async () => {
  let successCalls = 0;
  const successProvider: GenerationProvider = { async generate() {
    successCalls += 1;
    if (successCalls === 1) return "not-json";
    return { hooks: Array.from({ length: 10 }, (_, index) => ({ text: `repaired ${index}` })) };
  } };
  const successCoach = createService(new MemoryAgentRepository(), {
    generate: (request) => generateCoachHooks(request, { provider: successProvider, maxRetries: 2 }),
  });
  const successRun = await successCoach.createRun(undefined, { brief: completeBrief });
  const repaired = await successCoach.submitTurn(successRun.sessionToken, successRun.response.run.id, 0, { type: "confirm_brief" });
  assert.equal(successCalls, 2);
  assert.equal(repaired.run.status, "reviewing");
  assert.equal(repaired.candidates.length, 10);

  let retryCalls = 0;
  const retryProvider: GenerationProvider = { async generate() {
    retryCalls += 1;
    if (retryCalls <= 2) return { hooks: [] };
    return { hooks: Array.from({ length: 10 }, (_, index) => ({ text: `retry ${index}` })) };
  } };
  const retryCoach = createService(new MemoryAgentRepository(), {
    generate: (request) => generateCoachHooks(request, { provider: retryProvider, maxRetries: 2 }),
  });
  const retryRun = await retryCoach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(() => retryCoach.submitTurn(retryRun.sessionToken, retryRun.response.run.id, 0, { type: "confirm_brief" }));
  const failed = await retryCoach.getRun(retryRun.sessionToken, retryRun.response.run.id);
  assert.equal(failed.run.status, "failed");
  assert.equal(retryCalls, 2);
  const recovered = await retryCoach.submitTurn(retryRun.sessionToken, retryRun.response.run.id, failed.run.revision, { type: "retry" });
  assert.equal(retryCalls, 3);
  assert.equal(recovered.run.status, "reviewing");
  assert.equal(recovered.candidates.length, 10);
});

test("offline fixtures meet the measurable acceptance thresholds through real coach behavior", async () => {
  const observations: AgentOfflineObservation[] = [];

  for (let index = 0; index < 10; index += 1) {
    const created = await createService().createRun(undefined, { brief: { ...completeBrief, topic: `complete-${index}` } });
    observations.push({ kind: "complete_brief", unnecessaryClarification: created.response.run.clarificationAttempts !== 0 });
  }

  for (const field of ["topic", "platform", "contentType"] as const) {
    for (let index = 0; index < 10; index += 1) {
      const brief = { ...completeBrief } as Record<string, unknown>;
      delete brief[field];
      const created = await createService().createRun(undefined, { brief });
      const asked = created.response.messages.at(-1)?.content ?? "";
      observations.push({ kind: "missing_field", expectedField: field, correctlyAsked: asked.includes(field), questionCount: created.response.run.clarificationAttempts ?? 0 });
    }
  }

  const statuses: AgentRunStatus[] = [
    "understanding", "analyzing_image", "awaiting_brief_confirmation", "generating",
    "reviewing", "revising", "awaiting_final_confirmation", "completed", "failed", "cancelled",
  ];
  const tools: ToolName[] = ["analyze_image", "generate_hooks", "rewrite_hook", "regenerate_batch", "compare_candidates", "save_final_choice"];
  const approved = new Set(["analyzing_image:analyze_image", "generating:generate_hooks", "revising:rewrite_hook", "revising:regenerate_batch", "reviewing:compare_candidates", "awaiting_final_confirmation:save_final_choice"]);
  for (const status of statuses) {
    for (const tool of tools) {
      const shouldBlock = !approved.has(`${status}:${tool}`);
      let blocked = false;
      try { assertToolAllowed(status, tool); } catch { blocked = true; }
      if (shouldBlock) observations.push({ kind: "illegal_boundary", blocked });
    }
  }

  const repository = new MemoryAgentRepository();
  const coach = createService(repository);
  const created = await coach.createRun(undefined, { brief: completeBrief });
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" });
  observations.push({ kind: "candidate_count", expected: 10, actual: reviewed.candidates.length });
  const rewritten = await coach.submitTurn(created.sessionToken, created.response.run.id, reviewed.run.revision, { type: "rewrite_candidate", candidateId: reviewed.candidates[0]!.id });
  observations.push({ kind: "candidate_count", expected: 3, actual: rewritten.candidates.length });
  const regenerated = await coach.submitTurn(created.sessionToken, created.response.run.id, rewritten.run.revision, { type: "reject_batch", reason: "too generic" });
  observations.push({ kind: "candidate_count", expected: 10, actual: regenerated.candidates.length });

  const restored = await createService(repository).getRun(created.sessionToken, created.response.run.id);
  observations.push({ kind: "refresh_recovery", recovered: restored.run.id === created.response.run.id && restored.candidates.length === 10 });

  let sensitiveEventRejected = false;
  try {
    validateDashboardPayload("agent_tool_call", {
      status: "completed",
      tool: "generate_hooks",
      metadata: { topic: "private", message: "private", hook: "private", image: "private", email: "person@example.com" },
    });
  } catch { sensitiveEventRejected = true; }
  observations.push({ kind: "dashboard_safety", sensitiveLeakCount: sensitiveEventRejected ? 0 : 5 });

  const selected = await coach.submitTurn(created.sessionToken, created.response.run.id, regenerated.run.revision, { type: "select_candidate", candidateId: regenerated.candidates[0]!.id });
  await coach.submitTurn(created.sessionToken, created.response.run.id, selected.run.revision, { type: "confirm_final" });
  const memory = await coach.getMemory(created.sessionToken);
  const explicit = await coach.createRun(created.sessionToken, { brief: { ...completeBrief, platform: "x" } });
  observations.push({ kind: "memory_application", misused: explicit.response.run.brief?.platform !== "x" });
  for (const entry of memory.entries) await coach.deleteMemory(created.sessionToken, entry.id);
  observations.push({ kind: "memory_deletion", immediate: (await coach.getMemory(created.sessionToken)).entries.length === 0 });

  const report = evaluateAgentOfflineResults(observations);
  assert.equal(report.measurement, "offline_fixture");
  assert.equal(report.onlineProductionClaim, false);
  assert.deepEqual(report.failures, []);
  assert.ok(report.metrics.completeBriefInvalidClarificationRate <= AGENT_EVAL_THRESHOLDS.completeBriefInvalidClarificationRateMax);
  assert.ok(report.metrics.missingFieldCorrectClarificationRate >= AGENT_EVAL_THRESHOLDS.missingFieldCorrectClarificationRateMin);
  assert.equal(report.metrics.illegalBoundaryBlockRate, 1);
  assert.equal(report.metrics.candidateCountAccuracy, 1);
  assert.equal(report.metrics.refreshRecoveryRate, 1);
  assert.equal(report.metrics.dashboardSensitiveLeakCount, 0);
  assert.equal(report.metrics.memoryMisuseRate, 0);
  assert.equal(report.metrics.memoryDeletionImmediateRate, 1);
});

test("image understanding is structured, correctable, audited without bytes, and requires brief confirmation", async () => {
  const repository = new MemoryAgentRepository();
  const coach = createService(repository);
  const created = await coach.createRun(undefined, { brief: completeBrief, hasImage: true });
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "fixture.jpg", { type: "image/jpeg" });
  const analyzed = await coach.uploadImage(created.sessionToken, created.response.run.id, 0, file);
  assert.equal(analyzed.run.status, "awaiting_brief_confirmation");
  assert.equal(analyzed.pendingConfirmation, "brief");
  const audit = analyzed.run.toolCalls.find((call) => call.tool === "analyze_image")!;
  assert.deepEqual(audit.input, { mimeType: "image/jpeg", size: 4 });
  assert.equal(JSON.stringify(analyzed.run).includes("/9j/"), false);

  const corrected = await coach.submitTurn(created.sessionToken, created.response.run.id, analyzed.run.revision, {
    type: "message",
    text: JSON.stringify({ imageDescription: "Corrected safe scene description." }),
  });
  assert.equal(corrected.run.brief?.imageDescription, "Corrected safe scene description.");
});

test("approval, revision, ownership, retry, memory override and immediate deletion remain enforceable", async () => {
  const repository = new MemoryAgentRepository();
  let failOnce = true;
  const coach = createService(repository, { generate: async (request) => {
    if (failOnce) { failOnce = false; throw new Error("provider unavailable"); }
    return generated(request);
  } });
  const created = await coach.createRun(undefined, { brief: completeBrief });
  await assert.rejects(() => coach.getRun("another-session-token", created.response.run.id));
  await assert.rejects(() => coach.submitTurn(created.sessionToken, created.response.run.id, 99, { type: "confirm_brief" }), /Expected revision/);

  await assert.rejects(() => coach.submitTurn(created.sessionToken, created.response.run.id, 0, { type: "confirm_brief" }));
  const failed = await coach.getRun(created.sessionToken, created.response.run.id);
  assert.equal(failed.run.status, "failed");
  const reviewed = await coach.submitTurn(created.sessionToken, created.response.run.id, failed.run.revision, { type: "retry" });
  await assert.rejects(() => coach.submitTurn(created.sessionToken, created.response.run.id, reviewed.run.revision, { type: "confirm_final" }));
  const selected = await coach.submitTurn(created.sessionToken, created.response.run.id, reviewed.run.revision, { type: "select_candidate", candidateId: reviewed.candidates[0]!.id });
  const finalized = await coach.submitTurn(created.sessionToken, created.response.run.id, selected.run.revision, { type: "confirm_final" });
  assert.equal(finalized.run.approvals.at(-1)?.status, "approved");

  const remembered = await coach.getMemory(created.sessionToken);
  assert.ok(remembered.entries.length > 0);
  const explicit = await coach.createRun(created.sessionToken, { brief: { ...completeBrief, platform: "x" } });
  assert.equal(explicit.response.run.brief?.platform, "x");
  for (const entry of remembered.entries) await coach.deleteMemory(created.sessionToken, entry.id);
  assert.deepEqual((await coach.getMemory(created.sessionToken)).entries, []);
});

test("optimization protocol stops at three rounds or no improvement and keeps subjective quality human-owned", () => {
  assert.equal(shouldContinueAgentOptimization({ completedRounds: 0 }), true);
  assert.equal(shouldContinueAgentOptimization({ completedRounds: 3, previousScore: 0.5, currentScore: 0.9 }), false);
  assert.equal(shouldContinueAgentOptimization({ completedRounds: 1, previousScore: 0.8, currentScore: 0.8 }), false);
  assert.equal(shouldContinueAgentOptimization({ completedRounds: 1, previousScore: 0.8, currentScore: 0.7 }), false);
  assert.equal(shouldContinueAgentOptimization({ completedRounds: 1, previousScore: 0.7, currentScore: 0.8 }), true);
  assert.equal(AGENT_OBJECTIVE_RUBRIC.formatAndCountRetries.maximum, 1);
  assert.equal(AGENT_OBJECTIVE_RUBRIC.revisionRounds.maximum, 3);
  assert.equal(AGENT_HUMAN_PAIRWISE_PROTOCOL.positionSwapRequired, true);
  assert.equal(AGENT_HUMAN_PAIRWISE_PROTOCOL.modelScoreRepresentsCtr, false);
  assert.match(AGENT_HUMAN_PAIRWISE_PROTOCOL.note, /human|blind|pairwise/i);
  const missingEvidenceReport = evaluateAgentOfflineResults([]);
  assert.ok(missingEvidenceReport.failures.length >= 8);
  assert.ok(missingEvidenceReport.failures.some((failure) => failure.startsWith("missing offline evidence:")));
});
