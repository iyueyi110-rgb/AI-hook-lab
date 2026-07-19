import assert from "node:assert/strict";
import test from "node:test";

import { buildRunExportFiles } from "./export.ts";
import { buildEvaluationReport } from "./metrics.ts";
import type { EvaluationRunRecord } from "./types.ts";

test("run export produces the required seven traceable files", () => {
  const run = {
    id: "run-export",
    runName: "导出测试",
    dataOrigin: "evaluation_set",
    executionMode: "mock",
    status: "completed",
    caseCount: 0,
    baselinePromptVersion: "v1.0",
    candidatePromptVersion: "v1.1",
    modelName: "deepseek-chat",
    modelParameters: { temperature: 0.7 },
    generationTasks: [], formalResults: [], pairwiseDecisions: [],
    datasetVersion: "hook-eval-v1", cases: [], baselinePromptId: "p1", candidatePromptId: "p2",
    baselinePromptContent: "base", candidatePromptContent: "candidate", snapshotHash: "hash",
    evaluatorIds: ["a", "b"], adjudicatorId: "c", candidates: [], reviewAssignments: [], rawReviews: [],
    rawPairwiseEvaluations: [], adjudications: [], badCases: [], createdAt: "2026-07-13T00:00:00Z", updatedAt: "2026-07-13T00:00:00Z",
  } satisfies EvaluationRunRecord;
  const files = buildRunExportFiles(run, buildEvaluationReport(run));
  assert.deepEqual(Object.keys(files).sort(), [
    "bad_cases.csv", "evaluation_cases.csv", "evaluation_generations.csv", "evaluation_report.json",
    "evaluation_report.md", "human_evaluations.csv", "pairwise_evaluations.csv",
  ]);
  assert.match(files["evaluation_report.json"], /run-export/);
  assert.match(files["evaluation_report.md"], /模拟数据/);
  assert.match(files["evaluation_cases.csv"], /evaluationRunId/);
});
