import type {
  EvaluationReport,
  EvaluationRunSnapshot,
  FormalEvaluationResult,
  GateResult,
  PromptRole,
} from "./types";

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;
}

function resolvedIntent(result: FormalEvaluationResult, key: "favoriteIntent" | "adoptionIntent"): boolean | undefined {
  const adjudicated = key === "favoriteIntent" ? result.adjudicatedFavoriteIntent : result.adjudicatedAdoptionIntent;
  if (typeof adjudicated === "boolean") return adjudicated;
  if (result.reviews.length !== 2) return undefined;
  const [first, second] = result.reviews;
  return first[key] === second[key] ? first[key] : undefined;
}

function versionMetrics(run: EvaluationRunSnapshot, role: PromptRole, platform?: FormalEvaluationResult["platform"]) {
  const results = run.formalResults.filter((item) => item.promptRole === role && item.reviews.length === 2 && (!platform || item.platform === platform));
  const usability = results.map((item) => average(item.reviews.map((review) => review.usabilityScore)));
  const platformFit = results.map((item) => average(item.reviews.map((review) => review.platformFitScore)));
  const favorite = results.map((item) => resolvedIntent(item, "favoriteIntent"));
  const adoption = results.map((item) => resolvedIntent(item, "adoptionIntent"));
  const caseIds = new Set(results.map((item) => item.caseId));
  const tasks = run.generationTasks.filter((item) => item.promptRole === role && (!platform || caseIds.has(item.caseId)));
  return {
    scoredResults: results.length,
    usabilityRate: percent(usability.filter((score) => score >= 4).length, results.length),
    platformFitRate: percent(platformFit.filter((score) => score >= 4).length, results.length),
    favoriteIntentRate: percent(favorite.filter((value) => value === true).length, results.length),
    adoptionIntentRate: percent(adoption.filter((value) => value === true).length, results.length),
    averageAttractiveness: average(results.flatMap((item) => item.reviews.map((review) => review.attractivenessScore))),
    averageReasonQuality: average(results.flatMap((item) => item.reviews.map((review) => review.reasonQualityScore))),
    highSeverityBadCaseCount: results.reduce((sum, item) => sum + new Set(item.highSeverityBadCaseTypes).size, 0),
    overLengthCount: results.filter((item) => item.overLength).length,
    firstAttemptFormatErrorRate: percent(tasks.filter((task) => task.firstAttemptFormatError).length, tasks.length),
  };
}

function gate(passed: boolean, actual: number | null, threshold: string): GateResult {
  return { passed, actual, threshold };
}

export function buildEvaluationReport(run: EvaluationRunSnapshot): EvaluationReport {
  const baseline = versionMetrics(run, "baseline");
  const candidate = versionMetrics(run, "candidate");
  const decided = run.pairwiseDecisions.filter((item) => item.winnerRole);
  const candidateWins = decided.filter((item) => item.winnerRole === "candidate").length;
  const baselineWins = decided.filter((item) => item.winnerRole === "baseline").length;
  const ties = decided.filter((item) => item.winnerRole === "tie").length;
  const effective = candidateWins + baselineWins;
  const candidateWinRate = effective ? percent(candidateWins, effective) : null;

  const platformRegressions = (["xiaohongshu", "douyin", "bilibili"] as const).map((platform) => {
    const rateFor = (role: PromptRole) => {
      const values = run.formalResults.filter((item) => item.promptRole === role && item.platform === platform && item.reviews.length === 2);
      return percent(values.filter((item) => average(item.reviews.map((review) => review.usabilityScore)) >= 4).length, values.length);
    };
    return rateFor("candidate") - rateFor("baseline");
  });
  const worstPlatformChange = Math.min(...platformRegressions);

  const gates = {
    usabilityImprovement: gate(candidate.usabilityRate > baseline.usabilityRate, candidate.usabilityRate - baseline.usabilityRate, "> 0 个百分点"),
    platformFitImprovement: gate(candidate.platformFitRate - baseline.platformFitRate >= 8, candidate.platformFitRate - baseline.platformFitRate, "≥ 8 个百分点"),
    pairwiseWinRate: gate(candidateWinRate !== null && candidateWinRate > 55, candidateWinRate, "> 55%（排除平局）"),
    highSeverityRegression: gate(candidate.highSeverityBadCaseCount <= baseline.highSeverityBadCaseCount, candidate.highSeverityBadCaseCount - baseline.highSeverityBadCaseCount, "不得增加"),
    platformUsabilityRegression: gate(worstPlatformChange >= -5, worstPlatformChange, "任一平台下降不超过 5 个百分点"),
    formatErrorRegression: gate(candidate.firstAttemptFormatErrorRate <= baseline.firstAttemptFormatErrorRate, candidate.firstAttemptFormatErrorRate - baseline.firstAttemptFormatErrorRate, "不得高于 baseline"),
    lengthRegression: gate(candidate.overLengthCount <= baseline.overLengthCount, candidate.overLengthCount - baseline.overLengthCount, "不得增加"),
  };

  const complete =
    run.executionMode === "live" &&
    run.caseCount === 60 &&
    baseline.scoredResults === 60 &&
    candidate.scoredResults === 60 &&
    decided.length === 60 &&
    run.generationTasks.length === 120 &&
    run.generationTasks.every((task) => task.terminalStatus === "success") &&
    run.formalResults.every((result) =>
      resolvedIntent(result, "favoriteIntent") !== undefined && resolvedIntent(result, "adoptionIntent") !== undefined
    );
  const allPassed = Object.values(gates).every((item) => item.passed);
  const recommendation = !complete
    ? "needs_more_evaluation"
    : allPassed
      ? "recommend_upgrade"
      : "do_not_upgrade";
  const recommendationReason = run.executionMode === "mock"
    ? "模拟数据仅用于流程演示，不能形成 Prompt 升级结论"
    : !complete
      ? "评测数据尚未完成或未覆盖完整 60 个案例"
      : allPassed
        ? "candidate 通过全部七项升级门槛"
        : "candidate 未通过全部升级门槛";

  const platforms = Object.fromEntries((["xiaohongshu", "douyin", "bilibili"] as const).map((platform) => {
    const caseIds = new Set(run.formalResults.filter((item) => item.platform === platform).map((item) => item.caseId));
    const decisions = decided.filter((item) => caseIds.has(item.caseId));
    const wins = decisions.filter((item) => item.winnerRole === "candidate").length;
    const losses = decisions.filter((item) => item.winnerRole === "baseline").length;
    return [platform, {
      baseline: versionMetrics(run, "baseline", platform),
      candidate: versionMetrics(run, "candidate", platform),
      candidateWinRate: wins + losses ? percent(wins, wins + losses) : null,
      ties: decisions.filter((item) => item.winnerRole === "tie").length,
    }];
  })) as EvaluationReport["platforms"];

  const allBadCaseTypes = new Set(run.formalResults.flatMap((item) => item.badCaseTypes ?? item.highSeverityBadCaseTypes));
  const badCaseComparison = [...allBadCaseTypes].sort().map((type) => {
    const count = (role: PromptRole) => run.formalResults.filter((item) => item.promptRole === role && (item.badCaseTypes ?? item.highSeverityBadCaseTypes).includes(type)).length;
    const baselineCount = count("baseline");
    const candidateCount = count("candidate");
    const changeRate = baselineCount === 0 ? (candidateCount === 0 ? 0 : null) : Math.round(((candidateCount - baselineCount) / baselineCount) * 10_000) / 100;
    const changeLabel = baselineCount === 0 && candidateCount > 0 ? `新增 ${candidateCount} 条` : `${changeRate ?? 0}%`;
    return { type, baseline: baselineCount, candidate: candidateCount, changeRate, changeLabel };
  });

  return {
    recommendation,
    recommendationReason,
    versions: { baseline, candidate },
    pairwise: {
      totalCases: decided.length,
      candidateWins,
      baselineWins,
      ties,
      tieRate: percent(ties, decided.length),
      candidateWinRate,
    },
    platforms,
    badCaseComparison,
    gates,
  };
}
