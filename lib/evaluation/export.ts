import type { EvaluationReport, EvaluationRunRecord } from "./types";

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

export function buildRunExportFiles(run: EvaluationRunRecord, report: EvaluationReport): Record<string, string> {
  const metadata = [run.id, run.baselinePromptVersion, run.candidatePromptVersion, run.modelName, JSON.stringify(run.modelParameters), run.dataOrigin, run.createdAt, run.updatedAt];
  const sharedHeaders = ["evaluationRunId", "baselinePromptVersion", "candidatePromptVersion", "modelName", "modelParameters", "dataOrigin", "createdAt", "evaluatedAt"];
  const files: Record<string, string> = {};
  files["evaluation_cases.csv"] = toCsv([
    [...sharedHeaders, "caseId", "topicId", "topic", "category", "platform", "targetAudience", "emotionStyle", "lengthLimit", "datasetVersion"],
    ...run.cases.map((item) => [...metadata, item.caseId, item.topicId, item.topic, item.category, item.platform, item.targetAudience, item.emotionStyle, item.lengthLimit, item.datasetVersion]),
  ]);
  files["evaluation_generations.csv"] = toCsv([
    [...sharedHeaders, "generationId", "caseId", "promptRole", "candidateIndex", "content", "styleTag", "recommendReason", "modelSelfScore", "overLength", "duplicateRisk", "selected", "generationStatus"],
    ...run.candidates.map((item) => [...metadata, item.id, item.caseId, item.promptRole, item.candidateIndex, item.content, item.styleTag, item.recommendReason, item.modelScore ?? "", item.overLength, item.duplicateRisk, item.selected, item.generationStatus]),
  ]);
  files["human_evaluations.csv"] = toCsv([
    [...sharedHeaders, "evaluationId", "formalResultId", "caseId", "promptRole", "evaluatorId", "usabilityScore", "platformFitScore", "attractivenessScore", "reasonQualityScore", "favoriteIntent", "adoptionIntent", "note"],
    ...run.rawReviews.map((item) => [...metadata, item.id, item.formalResultId, item.caseId, item.promptRole, item.evaluatorId, item.usabilityScore, item.platformFitScore, item.attractivenessScore, item.reasonQualityScore, item.favoriteIntent, item.adoptionIntent, item.evaluatorNote ?? ""]),
  ]);
  files["pairwise_evaluations.csv"] = toCsv([
    [...sharedHeaders, "pairwiseEvaluationId", "caseId", "evaluatorId", "winnerBlindLabel", "comparisonReason"],
    ...run.rawPairwiseEvaluations.map((item) => [...metadata, item.id, item.caseId, item.evaluatorId, item.winner, item.comparisonReason ?? ""]),
  ]);
  files["bad_cases.csv"] = toCsv([
    [...sharedHeaders, "badCaseId", "formalResultId", "generationId", "type", "severity", "description", "rootCause", "improvementAction"],
    ...run.badCases.map((item) => [...metadata, item.id, item.formalResultId, item.generationId, item.type, item.severity, item.description ?? "", item.rootCause ?? "", item.improvementAction ?? ""]),
  ]);
  files["evaluation_report.json"] = JSON.stringify({
    evaluationRunId: run.id,
    runName: run.runName,
    promptVersions: { baseline: run.baselinePromptVersion, candidate: run.candidatePromptVersion },
    model: { name: run.modelName, parameters: run.modelParameters },
    dataOrigin: run.dataOrigin,
    executionMode: run.executionMode,
    createdAt: run.createdAt,
    evaluatedAt: run.updatedAt,
    report,
  }, null, 2);
  const recommendation = {
    recommend_upgrade: "建议升级",
    do_not_upgrade: "暂不升级",
    needs_more_evaluation: "需要继续评测",
  }[report.recommendation];
  files["evaluation_report.md"] = `# ${run.runName} 评测报告

- evaluationRunId: \`${run.id}\`
- 数据来源: \`${run.dataOrigin}\`
- 执行模式: ${run.executionMode === "mock" ? "模拟数据（不可形成升级结论）" : "Live 模型评测"}
- baseline / candidate: ${run.baselinePromptVersion} / ${run.candidatePromptVersion}
- 模型: ${run.modelName}
- 结论: **${recommendation}**
- 说明: ${report.recommendationReason}

## 整体结果

| 指标 | baseline | candidate |
| --- | ---: | ---: |
| 人工可用率 | ${report.versions.baseline.usabilityRate}% | ${report.versions.candidate.usabilityRate}% |
| 平台适配率 | ${report.versions.baseline.platformFitRate}% | ${report.versions.candidate.platformFitRate}% |
| 人工收藏意向率 | ${report.versions.baseline.favoriteIntentRate}% | ${report.versions.candidate.favoriteIntentRate}% |
| 人工采用意向率 | ${report.versions.baseline.adoptionIntentRate}% | ${report.versions.candidate.adoptionIntentRate}% |
| 字数超限 | ${report.versions.baseline.overLengthCount} | ${report.versions.candidate.overLengthCount} |

Candidate 成对胜率：${report.pairwise.candidateWinRate ?? "无有效比较"}%；平局 ${report.pairwise.ties} 条。
`;
  return files;
}
