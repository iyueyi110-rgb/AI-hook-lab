import type {
  EvaluationRunRecord,
  FormalEvaluationResult,
  PromptRole,
} from "./types.ts";
import type { StrategyEvaluationSnapshot } from "../strategy/types.ts";

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function resolvedAdoption(result: FormalEvaluationResult): boolean | undefined {
  if (typeof result.adjudicatedAdoptionIntent === "boolean") {
    return result.adjudicatedAdoptionIntent;
  }
  if (result.reviews.length !== 2) return undefined;
  return result.reviews[0]!.adoptionIntent === result.reviews[1]!.adoptionIntent
    ? result.reviews[0]!.adoptionIntent
    : undefined;
}

interface RoleMetrics {
  scoredResults: number;
  usabilityRate: number;
  platformFitRate: number;
  highSeverityBadCaseCount: number;
  adoptionIntentRate: number;
  firstAttemptFormatErrorRate: number;
  overLengthCount: number;
}

function roleMetrics(
  run: EvaluationRunRecord,
  role: PromptRole,
): RoleMetrics {
  const results = run.formalResults.filter(
    (result) => result.promptRole === role && result.reviews.length === 2,
  );
  const tasks = run.generationTasks.filter((task) => task.promptRole === role);
  return {
    scoredResults: results.length,
    usabilityRate: percent(
        results.filter(
          (result) =>
            average(result.reviews.map((review) => review.usabilityScore)) >= 4,
        ).length,
        results.length,
      ),
    platformFitRate: percent(
        results.filter(
          (result) =>
            average(result.reviews.map((review) => review.platformFitScore)) >= 4,
        ).length,
        results.length,
      ),
    highSeverityBadCaseCount: results.reduce(
        (sum, result) => sum + new Set(result.highSeverityBadCaseTypes).size,
        0,
      ),
    adoptionIntentRate: percent(
        results.filter((result) => resolvedAdoption(result) === true).length,
        results.length,
      ),
    firstAttemptFormatErrorRate: percent(
        tasks.filter((task) => task.firstAttemptFormatError).length,
        tasks.length,
      ),
    overLengthCount: results.filter((result) => result.overLength).length,
  };
}

export function buildStrategyEvaluationSnapshot(
  run: EvaluationRunRecord,
): StrategyEvaluationSnapshot {
  if (run.evaluationKind !== "strategy" || !run.strategyConfig) {
    throw new Error("Run is not a strategy evaluation");
  }
  const baseline = roleMetrics(run, "baseline");
  const candidate = roleMetrics(run, "candidate");
  const decided = run.pairwiseDecisions.filter((item) => item.winnerRole);
  const candidateWins = decided.filter(
    (item) => item.winnerRole === "candidate",
  ).length;
  const baselineWins = decided.filter(
    (item) => item.winnerRole === "baseline",
  ).length;
  const effective = candidateWins + baselineWins;
  return {
    evaluationRunId: run.id,
    evaluationKind: "strategy",
    executionMode: run.executionMode,
    status: run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "running",
    topicSetVersion: run.strategyConfig.topicSetVersion,
    scopePair: run.strategyConfig.scopePair,
    baselineStrategyRef: null,
    candidateStrategyRef: run.strategyConfig.candidateStrategyRef,
    caseCount: run.caseCount,
    baselineScoredResults: baseline.scoredResults,
    candidateScoredResults: candidate.scoredResults,
    pairwiseDecisionCount: decided.length,
    generationTaskCount: run.generationTasks.length,
    allGenerationTasksSucceeded: run.generationTasks.every(
      (task) => task.terminalStatus === "success",
    ),
    metrics: {
      baselineUsabilityRate: baseline.usabilityRate,
      candidateUsabilityRate: candidate.usabilityRate,
      baselinePlatformFitRate: baseline.platformFitRate,
      candidatePlatformFitRate: candidate.platformFitRate,
      candidateWinRate: effective
        ? percent(candidateWins, effective)
        : null,
      baselineHighSeverityBadCaseCount: baseline.highSeverityBadCaseCount,
      candidateHighSeverityBadCaseCount: candidate.highSeverityBadCaseCount,
      baselineAdoptionIntentRate: baseline.adoptionIntentRate,
      candidateAdoptionIntentRate: candidate.adoptionIntentRate,
      baselineFirstAttemptFormatErrorRate: baseline.firstAttemptFormatErrorRate,
      candidateFirstAttemptFormatErrorRate: candidate.firstAttemptFormatErrorRate,
      baselineOverLengthCount: baseline.overLengthCount,
      candidateOverLengthCount: candidate.overLengthCount,
    },
    ...(run.status === "completed" ? { completedAt: run.updatedAt } : {}),
  };
}
