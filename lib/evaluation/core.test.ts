import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDataOrigin } from "./origins.ts";
import { EVALUATION_CASES, validateCanonicalCases } from "./seeds.ts";
import { buildEvaluationReport } from "./metrics.ts";
import { csvCell } from "./export.ts";
import type { EvaluationRunSnapshot } from "./types.ts";

test("legacy data origins migrate explicitly and unknown origins are rejected", () => {
  assert.equal(normalizeDataOrigin("real_operation"), "real_user");
  assert.equal(normalizeDataOrigin("evaluation"), "evaluation_set");
  assert.equal(normalizeDataOrigin("simulated"), "simulation");
  assert.equal(normalizeDataOrigin("real_user"), "real_user");
  assert.throws(() => normalizeDataOrigin("other"), /Unsupported dataOrigin/);
});

test("canonical evaluation seed contains exactly twenty topics across three platforms", () => {
  assert.equal(EVALUATION_CASES.length, 60);
  assert.equal(new Set(EVALUATION_CASES.map((item) => item.topicId)).size, 20);
  assert.deepEqual(validateCanonicalCases(EVALUATION_CASES), []);
  for (const topicId of new Set(EVALUATION_CASES.map((item) => item.topicId))) {
    assert.deepEqual(
      EVALUATION_CASES.filter((item) => item.topicId === topicId)
        .map((item) => item.platform)
        .sort(),
      ["bilibili", "douyin", "xiaohongshu"],
    );
  }
});

test("mock and incomplete runs never produce an upgrade recommendation", () => {
  const run = emptyRun({ executionMode: "mock", caseCount: 60 });
  const report = buildEvaluationReport(run);
  assert.equal(report.recommendation, "needs_more_evaluation");
  assert.match(report.recommendationReason, /模拟/);
});

test("paired reviewer results aggregate by formal result instead of raw votes", () => {
  const run = passingRun();
  const report = buildEvaluationReport(run);
  assert.equal(report.versions.baseline.scoredResults, 60);
  assert.equal(report.versions.candidate.scoredResults, 60);
  assert.equal(report.pairwise.totalCases, 60);
  assert.equal(report.recommendation, "recommend_upgrade");
});

test("candidate length regressions block an otherwise passing upgrade", () => {
  const run = passingRun();
  run.formalResults.find((result) => result.promptRole === "candidate")!.overLength = true;
  const report = buildEvaluationReport(run);
  assert.equal(report.recommendation, "do_not_upgrade");
  assert.equal(report.gates.lengthRegression.passed, false);
});

test("report exposes three platform sections and labels bad cases added from a zero baseline", () => {
  const run = passingRun();
  const candidate = run.formalResults.find((result) => result.promptRole === "candidate")!;
  candidate.highSeverityBadCaseTypes = ["factual_risk"];
  candidate.badCaseTypes = ["factual_risk"];
  const report = buildEvaluationReport(run);
  assert.deepEqual(Object.keys(report.platforms).sort(), ["bilibili", "douyin", "xiaohongshu"]);
  assert.equal(report.platforms.xiaohongshu.baseline.scoredResults, 20);
  const issue = report.badCaseComparison.find((item) => item.type === "factual_risk")!;
  assert.equal(issue.changeRate, null);
  assert.equal(issue.changeLabel, "新增 1 条");
});

test("csv export neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(\"bad\")"), "\"'=HYPERLINK(\"\"bad\"\")\"");
  assert.equal(csvCell("normal"), "\"normal\"");
});

function emptyRun(overrides: Partial<EvaluationRunSnapshot> = {}): EvaluationRunSnapshot {
  return {
    id: "run-1",
    runName: "test",
    dataOrigin: "evaluation_set",
    executionMode: "live",
    status: "completed",
    caseCount: 0,
    baselinePromptVersion: "v1.0",
    candidatePromptVersion: "v1.1",
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7 },
    generationTasks: [],
    formalResults: [],
    pairwiseDecisions: [],
    ...overrides,
  };
}

function passingRun(): EvaluationRunSnapshot {
  const run = emptyRun({ caseCount: 60 });
  for (let index = 1; index <= 60; index += 1) {
    const caseId = `CASE_${String(index).padStart(3, "0")}_XHS`;
    for (const promptRole of ["baseline", "candidate"] as const) {
      const candidate = promptRole === "candidate";
      run.generationTasks.push({
        id: `${caseId}-${promptRole}`,
        caseId,
        promptRole,
        firstAttemptFormatError: false,
        terminalStatus: "success",
      });
      run.formalResults.push({
        id: `${caseId}-${promptRole}-formal`,
        caseId,
        platform: index <= 20 ? "xiaohongshu" : index <= 40 ? "douyin" : "bilibili",
        promptRole,
        overLength: false,
        highSeverityBadCaseTypes: [],
        reviews: [
          score(candidate ? 5 : 3, candidate ? 5 : 3, true, true),
          score(candidate ? 5 : 3, candidate ? 5 : 3, true, true),
        ],
      });
    }
    run.pairwiseDecisions.push({ caseId, winnerRole: "candidate" });
  }
  return run;
}

function score(
  usabilityScore: number,
  platformFitScore: number,
  favoriteIntent: boolean,
  adoptionIntent: boolean,
) {
  return {
    evaluatorId: crypto.randomUUID(),
    usabilityScore,
    platformFitScore,
    attractivenessScore: usabilityScore,
    reasonQualityScore: usabilityScore,
    favoriteIntent,
    adoptionIntent,
  };
}
