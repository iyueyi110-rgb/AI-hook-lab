import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonStrategyRepository, STRATEGY_SCHEMA_SQL } from "./repository.ts";
import { StrategyConflictError, StrategyService } from "./service.ts";
import type { StrategyEvaluationSnapshot } from "./types.ts";
import { computeStrategyContentHash, validateStrategyContent } from "./validation.ts";

const draft = {
  title: "抖音教程具体结果策略",
  scopePairs: [{ platform: "douyin", contentType: "tutorial" }] as const,
  audienceLabel: "新手",
  guidance: { do: ["用具体结果开头"], avoid: ["避免书面化开场"] },
  hypothesis: "降低平台语气不匹配问题。",
};

function passingEvaluation(cardId: string, version: number): StrategyEvaluationSnapshot {
  return {
    evaluationKind: "strategy",
    executionMode: "live",
    status: "completed",
    topicSetVersion: "strategy-hook-topics-v1",
    scopePair: draft.scopePairs[0],
    baselineStrategyRef: null,
    candidateStrategyRef: { id: cardId, version },
    caseCount: 20,
    baselineScoredResults: 20,
    candidateScoredResults: 20,
    pairwiseDecisionCount: 20,
    generationTaskCount: 40,
    allGenerationTasksSucceeded: true,
    metrics: {
      baselineUsabilityRate: 60,
      candidateUsabilityRate: 70,
      baselinePlatformFitRate: 55,
      candidatePlatformFitRate: 65,
      candidateWinRate: 60,
      baselineHighSeverityBadCaseCount: 1,
      candidateHighSeverityBadCaseCount: 1,
      baselineAdoptionIntentRate: 50,
      candidateAdoptionIntentRate: 55,
      baselineFirstAttemptFormatErrorRate: 5,
      candidateFirstAttemptFormatErrorRate: 0,
      baselineOverLengthCount: 1,
      candidateOverLengthCount: 1,
    },
    completedAt: "2026-07-27T00:00:00.000Z",
  };
}

test("strategy schema contains governed tables and no experiment table", () => {
  for (const table of [
    "content_strategy_card",
    "content_strategy_version",
    "content_strategy_evidence",
    "content_strategy_review",
    "creative_strategy_assignment",
  ]) assert.match(STRATEGY_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.doesNotMatch(STRATEGY_SCHEMA_SQL, /content_strategy_experiment/);
  assert.match(STRATEGY_SCHEMA_SQL, /USING GIN/);
  assert.match(STRATEGY_SCHEMA_SQL, /one_active_per_card/);
  assert.match(STRATEGY_SCHEMA_SQL, /FOREIGN KEY \(card_id, strategy_version\)/);
});

test("JSON strategy repository persists independent governed state atomically", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "strategy-store-"));
  const file = path.join(dir, "strategies.json");
  const repository = new JsonStrategyRepository(file);
  const service = new StrategyService(repository, () => new Date("2026-07-28T00:00:00.000Z"));
  const created = await service.createDraft("admin-1", draft);
  assert.equal(created.version.status, "draft");
  const persisted = JSON.parse(await readFile(file, "utf8")) as { cards: unknown[]; versions: unknown[] };
  assert.equal(persisted.cards.length, 1);
  assert.equal(persisted.versions.length, 1);
});

test("draft editing is revision checked and submitted content becomes immutable", async () => {
  const repository = new JsonStrategyRepository(path.join(await mkdtemp(path.join(os.tmpdir(), "strategy-edit-")), "state.json"));
  const service = new StrategyService(repository, () => new Date("2026-07-28T00:00:00.000Z"));
  const created = await service.createDraft("admin-1", draft);
  const edited = await service.updateDraft(created.card.id, 1, "admin-1", 0, {
    ...draft,
    title: "更新后的标题",
  });
  assert.equal(edited.title, "更新后的标题");
  assert.equal(edited.revision, 1);
  await assert.rejects(
    () => service.updateDraft(created.card.id, 1, "admin-1", 0, draft),
    StrategyConflictError,
  );
  const submitted = await service.action(created.card.id, 1, "admin-1", {
    action: "submit_review",
    expectedRevision: 1,
  });
  await assert.rejects(
    () => service.updateDraft(created.card.id, 1, "admin-1", submitted.revision, draft),
    /immutable/,
  );
});

test("approved strategy activates only after fresh exact evaluation and binds atomically", async () => {
  const repository = new JsonStrategyRepository(path.join(await mkdtemp(path.join(os.tmpdir(), "strategy-bind-")), "state.json"));
  let now = new Date("2026-07-28T00:00:00.000Z");
  const service = new StrategyService(repository, () => now);
  const created = await service.createDraft("admin-1", draft);
  let current = await service.action(created.card.id, 1, "admin-1", { action: "submit_review", expectedRevision: 0 });
  current = await service.action(created.card.id, 1, "admin-1", { action: "approve_experiment", expectedRevision: current.revision });
  await service.recordEvaluation("admin-1", passingEvaluation(created.card.id, 1));
  current = await service.action(created.card.id, 1, "admin-1", {
    action: "activate",
    expectedRevision: current.revision,
    expiresInDays: 30,
  });
  assert.equal(current.status, "active");

  const active = await service.listActive(draft.scopePairs[0], now);
  assert.equal(active.length, 1);
  assert.deepEqual(Object.keys(active[0]!).sort(), [
    "activatedAt", "audienceLabel", "evidenceUpdatedAt", "expiresAt", "guidance", "id", "scopePairs", "title", "version",
  ]);

  const assignment = await service.bindActive("run-1", { id: created.card.id, version: 1 }, draft.scopePairs[0], now);
  assert.equal(assignment.appliedGuidanceHash, current.contentHash);
  await assert.rejects(
    () => service.bindActive("run-1", { id: created.card.id, version: 1 }, draft.scopePairs[0], now),
    StrategyConflictError,
  );

  now = new Date("2026-07-28T00:01:00.000Z");
  await service.action(created.card.id, 1, "admin-1", { action: "archive", expectedRevision: current.revision });
  assert.ok(await service.getAssignment("run-1"));
  await assert.rejects(
    () => service.bindActive("run-2", { id: created.card.id, version: 1 }, draft.scopePairs[0], now),
    /strategy_not_active/,
  );
});

test("strategy feedback is enum-only and idempotently updates the run assignment", async () => {
  const repository = new JsonStrategyRepository(path.join(await mkdtemp(path.join(os.tmpdir(), "strategy-feedback-")), "state.json"));
  const service = new StrategyService(repository);
  await repository.transaction((state) => {
    state.assignments.push({
      runId: "run-1",
      cardId: "card-1",
      strategyVersion: 1,
      appliedGuidanceHash: "a".repeat(64),
      boundAt: new Date().toISOString(),
    });
  });
  const feedback = await service.recordFeedback("run-1", "not_applicable", "audience");
  assert.equal(feedback.strategyFit, "not_applicable");
  assert.equal(feedback.notApplicableReason, "audience");
  const replaced = await service.recordFeedback("run-1", "helpful");
  assert.equal(replaced.strategyFit, "helpful");
  assert.equal(replaced.notApplicableReason, undefined);
});

test("JSON fallback preserves 1,000-card lookup and 100 concurrent binding semantics", async () => {
  const repository = new JsonStrategyRepository(
    path.join(await mkdtemp(path.join(os.tmpdir(), "strategy-scale-")), "state.json"),
  );
  const service = new StrategyService(repository, () => new Date("2026-07-28T00:00:00.000Z"));
  const content = validateStrategyContent(draft);
  const contentHash = computeStrategyContentHash(content);
  await repository.transaction((state) => {
    for (let index = 0; index < 1_000; index += 1) {
      const cardId = `card-${String(index).padStart(4, "0")}`;
      state.cards.push({
        id: cardId,
        currentVersion: 1,
        createdBy: "scale-test",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      });
      state.versions.push({
        ...content,
        cardId,
        version: 1,
        revision: 1,
        status: index < 10 ? "active" : "archived",
        contentHash,
        createdBy: "scale-test",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
        ...(index < 10
          ? {
              activatedAt: `2026-07-27T00:${String(index).padStart(2, "0")}:00.000Z`,
              expiresAt: "2026-08-27T00:00:00.000Z",
            }
          : {
              archivedAt: "2026-07-27T00:00:00.000Z",
            }),
      });
      if (index < 10) {
        state.evidence.push({
          id: `evidence-${index}`,
          cardId,
          strategyVersion: 1,
          origin: "evaluation_set",
          eligibility: "activation_eligible",
          sampleSize: 20,
          caveats: [],
          collectedAt: `2026-07-27T01:${String(index).padStart(2, "0")}:00.000Z`,
        });
      }
    }
  });

  const active = await service.listActive(draft.scopePairs[0]);
  assert.equal(active.length, 5);
  assert.deepEqual(active.map((item) => item.id), [
    "card-0009",
    "card-0008",
    "card-0007",
    "card-0006",
    "card-0005",
  ]);

  const assignments = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      service.bindActive(
        `run-${index}`,
        { id: `card-${String(index % 10).padStart(4, "0")}`, version: 1 },
        draft.scopePairs[0],
      )),
  );
  assert.equal(assignments.length, 100);
  assert.equal(new Set(assignments.map((item) => item.runId)).size, 100);
  assert.equal((await repository.read()).assignments.length, 100);
});
