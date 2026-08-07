import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDataOrigin,
  formatExecutionMode,
  formatGenerationErrorCategory,
  formatRunStatus,
  summarizeEvaluationReport,
} from "./presentation.ts";
import type { EvaluationReport } from "./types.ts";

test("evaluation display labels hide internal enum values", () => {
  assert.equal(formatDataOrigin("evaluation_set"), "离线评测数据");
  assert.equal(formatExecutionMode("mock"), "Mock 流程演示");
  assert.equal(formatRunStatus("reviewing"), "评分中");
  assert.equal(formatRunStatus("not-a-status"), "未知状态");
});

test("legacy generation errors keep storage compatibility but receive safe display labels", () => {
  assert.equal(formatGenerationErrorCategory("API Key 未配置"), "生成服务配置异常");
  assert.equal(formatGenerationErrorCategory("JSON 解析失败"), "生成结果格式异常");
  assert.equal(formatGenerationErrorCategory("请求超时"), "请求超时");
});

test("prompt report summary exposes a readable recommendation and all seven gates", () => {
  const report = sampleReport();
  const summary = summarizeEvaluationReport(report);
  assert.equal(summary.recommendationLabel, "需要继续评测");
  assert.equal(summary.totalGateCount, 7);
  assert.equal(summary.passedGateCount, 0);
  assert.equal(summary.metrics[0].value, "待完成");
  assert.equal(summary.metrics[2].value, "待完成");
  assert.match(summary.reason, /尚未完成/);
});

function sampleReport(): EvaluationReport {
  const version = {
    scoredResults: 0,
    usabilityRate: 0,
    platformFitRate: 0,
    favoriteIntentRate: 0,
    adoptionIntentRate: 0,
    averageAttractiveness: 0,
    averageReasonQuality: 0,
    highSeverityBadCaseCount: 0,
    overLengthCount: 0,
    firstAttemptFormatErrorRate: 0,
  };
  const gate = { passed: false, actual: null, threshold: "待完成" };
  return {
    recommendation: "needs_more_evaluation",
    recommendationReason: "评测数据尚未完成或未覆盖完整 60 个案例",
    versions: { baseline: version, candidate: version },
    pairwise: {
      totalCases: 0,
      candidateWins: 0,
      baselineWins: 0,
      ties: 0,
      tieRate: 0,
      candidateWinRate: null,
    },
    platforms: {
      xiaohongshu: { baseline: version, candidate: version, candidateWinRate: null, ties: 0 },
      douyin: { baseline: version, candidate: version, candidateWinRate: null, ties: 0 },
      bilibili: { baseline: version, candidate: version, candidateWinRate: null, ties: 0 },
    },
    badCaseComparison: [],
    gates: {
      usabilityImprovement: gate,
      platformFitImprovement: gate,
      pairwiseWinRate: gate,
      highSeverityRegression: gate,
      platformUsabilityRegression: gate,
      formatErrorRegression: gate,
      lengthRegression: gate,
    },
  };
}
