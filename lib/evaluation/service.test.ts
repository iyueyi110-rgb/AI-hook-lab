import assert from "node:assert/strict";
import test from "node:test";

import { MemoryEvaluationRepository } from "./repository.ts";
import { EvaluationService } from "./service.ts";

test("admin creates isolated reviewer accounts and a full immutable run snapshot", async () => {
  const service = await setupService();
  const state = await service.getState();
  const admin = state.users.find((user) => user.role === "admin")!;
  const evaluators = state.users.filter((user) => user.role === "evaluator");
  const adjudicator = state.users.find((user) => user.role === "adjudicator")!;
  const run = await service.createRun(admin.id, {
    runName: "完整离线评测",
    executionMode: "mock",
    evaluatorIds: [evaluators[0].id, evaluators[1].id],
    adjudicatorId: adjudicator.id,
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7 },
  });
  assert.equal(run.caseCount, 60);
  assert.equal(run.generationTasks.length, 120);
  assert.equal(run.reviewAssignments.length, 120);
  assert.equal(run.snapshotHash.length, 64);
  assert.equal(run.dataOrigin, "evaluation_set");
  assert.notEqual(run.baselinePromptContent, run.candidatePromptContent);
});

test("one recoverable generation step processes baseline and candidate for one case", async () => {
  const { service, adminId, runId } = await setupRun();
  const updated = await service.generateNext(adminId, runId);
  assert.equal(updated.candidates.length, 6);
  assert.equal(updated.generationTasks.filter((task) => task.terminalStatus === "success").length, 2);
  assert.equal(updated.status, "generating");
  assert.equal(new Set(updated.candidates.map((item) => item.promptRole)).size, 2);
});

test("only admins can select one formal candidate per case and prompt", async () => {
  const { service, adminId, evaluatorId, runId } = await setupRun();
  const generated = await service.generateNext(adminId, runId);
  const candidate = generated.candidates[0];
  await assert.rejects(() => service.selectCandidate(evaluatorId, runId, candidate.id), /admin/);
  const selected = await service.selectCandidate(adminId, runId, candidate.id);
  assert.equal(selected.formalResults.length, 1);
  assert.equal(selected.candidates.filter((item) => item.selected).length, 1);
});

test("reviewers cannot submit reviews for another reviewer assignment", async () => {
  const { service, adminId, evaluatorId, otherEvaluatorId, runId } = await setupRun();
  const generated = await service.generateNext(adminId, runId);
  const baselineCandidate = generated.candidates.find((item) => item.promptRole === "baseline")!;
  const selected = await service.selectCandidate(adminId, runId, baselineCandidate.id);
  const formal = selected.formalResults[0];
  await service.submitReview(evaluatorId, runId, formal.id, validReview());
  await assert.rejects(
    () => service.submitReview(otherEvaluatorId, runId, formal.id, validReview(), evaluatorId),
    /own identity/,
  );
});

test("prompt content is versioned immutably and duplicate versions are rejected", async () => {
  const service = await setupService();
  const state = await service.getState();
  const adminId = state.users.find((user) => user.role === "admin")!.id;
  const created = await service.createPromptVersion(adminId, {
    version: "v1.2",
    name: "candidate v1.2",
    promptContent: "全新的候选 Prompt 内容",
    changeSummary: "修复平台语气",
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7 },
  });
  assert.equal(created.role, "candidate");
  await assert.rejects(() => service.createPromptVersion(adminId, {
    version: "v1.2", name: "duplicate", promptContent: "覆盖历史内容", changeSummary: "bad",
    modelName: "deepseek-chat", modelParameters: {},
  }), /already exists/);
  const persisted = await service.getState();
  assert.equal(persisted.promptVersions.find((item) => item.version === "v1.2")?.promptContent, "全新的候选 Prompt 内容");
});

test("generation records first-attempt format errors, retries, and preserves successful evidence", async () => {
  const attempts = new Map<string, number>();
  const repository = new MemoryEvaluationRepository();
  const service = new EvaluationService(repository, {
    async generate(input) {
      const key = input.promptRole;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const count = attempt === 1 ? 2 : 3;
      return { hooks: Array.from({ length: count }, (_, index) => ({ content: `Hook ${index}`, styleTag: "测试", recommendReason: "具体原因" })) };
    },
  });
  const { adminId, runId } = await setupRunWithService(service);
  const run = await service.generateNext(adminId, runId);
  assert.equal(run.generationTasks.slice(0, 2).every((task) => task.firstAttemptFormatError), true);
  assert.equal(run.generationTasks.slice(0, 2).every((task) => task.attemptCount === 2), true);
  assert.equal(run.candidates.length, 6);
});

test("terminal generation failures can be explicitly reset and regenerated", async () => {
  let failing = true;
  const service = new EvaluationService(new MemoryEvaluationRepository(), {
    async generate() {
      if (failing) throw new Error("Generation error: provider unavailable");
      return { hooks: [0, 1, 2].map((index) => ({ content: `Recovered ${index}`, styleTag: "恢复", recommendReason: "重试成功证据" })) };
    },
  });
  const { adminId, runId } = await setupRunWithService(service);
  const failed = await service.generateNext(adminId, runId);
  const failedIds = failed.generationTasks.filter((task) => task.terminalStatus === "generation_error").map((task) => task.id);
  assert.equal(failedIds.length, 2);
  failing = false;
  for (const taskId of failedIds) await service.retryGenerationTask(adminId, runId, taskId);
  const recovered = await service.generateNext(adminId, runId);
  assert.equal(recovered.generationTasks.filter((task) => failedIds.includes(task.id)).every((task) => task.terminalStatus === "success"), true);
});

test("admins can disable and reset internal accounts without changing identity", async () => {
  const service = await setupService();
  const state = await service.getState();
  const adminId = state.users.find((user) => user.role === "admin")!.id;
  const reviewer = state.users.find((user) => user.role === "evaluator")!;
  await service.updateUser(adminId, reviewer.id, { status: "disabled" });
  assert.equal((await service.getState()).users.find((user) => user.id === reviewer.id)?.status, "disabled");
  await service.updateUser(adminId, reviewer.id, { status: "active", password: "replacement-pass-123" });
  const auth = await service.authenticate(reviewer.username, "replacement-pass-123");
  assert.equal(auth.user.id, reviewer.id);
});

test("persisted blind labels resolve different reviewer mappings back to the same candidate role", async () => {
  const { service, adminId, evaluatorId, otherEvaluatorId, runId } = await setupRun();
  const generated = await service.generateNext(adminId, runId);
  for (const role of ["baseline", "candidate"] as const) {
    const candidate = generated.candidates.find((item) => item.promptRole === role)!;
    await service.selectCandidate(adminId, runId, candidate.id);
  }
  const state = await service.getState();
  const run = state.runs.find((item) => item.id === runId)!;
  const caseId = run.cases[0].caseId;
  for (const reviewerId of [evaluatorId, otherEvaluatorId]) {
    const assignment = run.reviewAssignments.find((item) => item.caseId === caseId && item.evaluatorId === reviewerId)!;
    const candidateLabel = assignment.optionA === "candidate" ? "A" : "B";
    await service.submitPairwise(reviewerId, runId, caseId, candidateLabel);
  }
  const resolved = (await service.getState()).runs.find((item) => item.id === runId)!;
  assert.equal(resolved.pairwiseDecisions.find((item) => item.caseId === caseId)?.winnerRole, "candidate");
  await assert.rejects(() => service.report(evaluatorId, runId), /completed/);
});

async function setupService() {
  const repository = new MemoryEvaluationRepository();
  const service = new EvaluationService(repository);
  await service.initialize();
  const admin = await service.setupFirstAdmin("admin", "管理员", "admin-password-123");
  await service.createUser(admin.id, { username: "reviewer-a", displayName: "评测员 A", password: "reviewer-password-123", role: "evaluator" });
  await service.createUser(admin.id, { username: "reviewer-b", displayName: "评测员 B", password: "reviewer-password-456", role: "evaluator" });
  await service.createUser(admin.id, { username: "judge", displayName: "裁决员", password: "adjudicator-pass-123", role: "adjudicator" });
  return service;
}

async function setupRun() {
  const service = await setupService();
  return setupRunWithService(service);
}

async function setupRunWithService(service: EvaluationService) {
  const initial = await service.getState();
  if (initial.users.length === 0) {
    const admin = await service.setupFirstAdmin("admin", "管理员", "admin-password-123");
    await service.createUser(admin.id, { username: "reviewer-a", displayName: "评测员 A", password: "reviewer-password-123", role: "evaluator" });
    await service.createUser(admin.id, { username: "reviewer-b", displayName: "评测员 B", password: "reviewer-password-456", role: "evaluator" });
    await service.createUser(admin.id, { username: "judge", displayName: "裁决员", password: "adjudicator-pass-123", role: "adjudicator" });
  }
  const state = await service.getState();
  const adminId = state.users.find((user) => user.role === "admin")!.id;
  const evaluators = state.users.filter((user) => user.role === "evaluator");
  const adjudicatorId = state.users.find((user) => user.role === "adjudicator")!.id;
  const run = await service.createRun(adminId, {
    runName: "Mock run",
    executionMode: "mock",
    evaluatorIds: [evaluators[0].id, evaluators[1].id],
    adjudicatorId,
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7 },
  });
  return { service, adminId, evaluatorId: evaluators[0].id, otherEvaluatorId: evaluators[1].id, runId: run.id };
}

function validReview() {
  return {
    usabilityScore: 4,
    platformFitScore: 4,
    attractivenessScore: 4,
    reasonQualityScore: 4,
    favoriteIntent: true,
    adoptionIntent: true,
    evaluatorNote: "少量修改即可使用",
    badCases: [],
  };
}
