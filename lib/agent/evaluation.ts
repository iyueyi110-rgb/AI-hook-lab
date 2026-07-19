export const AGENT_EVAL_THRESHOLDS = Object.freeze({
  completeBriefInvalidClarificationRateMax: 0.1,
  missingFieldCorrectClarificationRateMin: 0.9,
  illegalBoundaryBlockRateMin: 1,
  candidateCountAccuracyMin: 1,
  refreshRecoveryRateMin: 1,
  dashboardSensitiveLeakCountMax: 0,
  memoryMisuseRateMax: 0.05,
  memoryDeletionImmediateRateMin: 1,
});

export const AGENT_OBJECTIVE_RUBRIC = Object.freeze({
  stateTransition: { method: "deterministic", pass: "The resulting state matches the transition matrix." },
  candidateSchema: { method: "deterministic", pass: "Every candidate satisfies the response schema." },
  candidateCount: { method: "deterministic", pass: "Initial/regenerate return 10; rewrite returns 3." },
  illegalToolBlocking: { method: "deterministic", pass: "Every tool outside its exact allowed state is rejected." },
  sensitiveAnalytics: { method: "deterministic", pass: "No topic, message, Hook, image, or PII enters an Agent dashboard event." },
  formatAndCountRetries: { method: "deterministic", maximum: 1 },
  revisionRounds: { method: "deterministic", maximum: 3 },
});

export const AGENT_HUMAN_PAIRWISE_PROTOCOL = Object.freeze({
  dimensions: ["topic relevance", "platform fit", "opening impact", "actionability", "non-clickbait quality"],
  scale: "pairwise_preference",
  blinded: true,
  positionSwapRequired: true,
  disagreementResult: "tie_or_human_adjudication",
  modelScoreRepresentsCtr: false,
  note: "Hook quality and Top 3 explanation quality require human blind pairwise review; model scores are ranking explanations, not observed CTR.",
});

export type AgentOfflineObservation =
  | { kind: "complete_brief"; unnecessaryClarification: boolean }
  | { kind: "missing_field"; expectedField: "topic" | "platform" | "contentType"; correctlyAsked: boolean; questionCount: number }
  | { kind: "illegal_boundary"; blocked: boolean }
  | { kind: "candidate_count"; expected: 3 | 10; actual: number }
  | { kind: "refresh_recovery"; recovered: boolean }
  | { kind: "dashboard_safety"; sensitiveLeakCount: number }
  | { kind: "memory_application"; misused: boolean }
  | { kind: "memory_deletion"; immediate: boolean };

export interface AgentOfflineEvalReport {
  measurement: "offline_fixture";
  onlineProductionClaim: false;
  thresholds: typeof AGENT_EVAL_THRESHOLDS;
  metrics: {
    completeBriefInvalidClarificationRate: number;
    missingFieldCorrectClarificationRate: number;
    illegalBoundaryBlockRate: number;
    candidateCountAccuracy: number;
    refreshRecoveryRate: number;
    dashboardSensitiveLeakCount: number;
    memoryMisuseRate: number;
    memoryDeletionImmediateRate: number;
  };
  sampleSizes: Record<AgentOfflineObservation["kind"], number>;
  failures: string[];
}

function rate(passing: number, total: number): number {
  return total === 0 ? 0 : passing / total;
}

export function evaluateAgentOfflineResults(observations: AgentOfflineObservation[]): AgentOfflineEvalReport {
  const byKind = <K extends AgentOfflineObservation["kind"]>(kind: K) =>
    observations.filter((item): item is Extract<AgentOfflineObservation, { kind: K }> => item.kind === kind);

  const complete = byKind("complete_brief");
  const missing = byKind("missing_field");
  const boundaries = byKind("illegal_boundary");
  const counts = byKind("candidate_count");
  const recovery = byKind("refresh_recovery");
  const dashboards = byKind("dashboard_safety");
  const memoryApplications = byKind("memory_application");
  const memoryDeletions = byKind("memory_deletion");

  const metrics = {
    completeBriefInvalidClarificationRate: rate(complete.filter((item) => item.unnecessaryClarification).length, complete.length),
    missingFieldCorrectClarificationRate: rate(missing.filter((item) => item.correctlyAsked && item.questionCount <= 2).length, missing.length),
    illegalBoundaryBlockRate: rate(boundaries.filter((item) => item.blocked).length, boundaries.length),
    candidateCountAccuracy: rate(counts.filter((item) => item.actual === item.expected).length, counts.length),
    refreshRecoveryRate: rate(recovery.filter((item) => item.recovered).length, recovery.length),
    dashboardSensitiveLeakCount: dashboards.reduce((total, item) => total + item.sensitiveLeakCount, 0),
    memoryMisuseRate: rate(memoryApplications.filter((item) => item.misused).length, memoryApplications.length),
    memoryDeletionImmediateRate: rate(memoryDeletions.filter((item) => item.immediate).length, memoryDeletions.length),
  };

  const failures: string[] = [];
  const evidence: Array<[AgentOfflineObservation["kind"], number]> = [
    ["complete_brief", complete.length], ["missing_field", missing.length], ["illegal_boundary", boundaries.length],
    ["candidate_count", counts.length], ["refresh_recovery", recovery.length], ["dashboard_safety", dashboards.length],
    ["memory_application", memoryApplications.length], ["memory_deletion", memoryDeletions.length],
  ];
  for (const [kind, count] of evidence) if (count === 0) failures.push(`missing offline evidence: ${kind}`);
  if (metrics.completeBriefInvalidClarificationRate > AGENT_EVAL_THRESHOLDS.completeBriefInvalidClarificationRateMax) failures.push("complete brief clarification rate");
  if (metrics.missingFieldCorrectClarificationRate < AGENT_EVAL_THRESHOLDS.missingFieldCorrectClarificationRateMin) failures.push("missing field clarification rate");
  if (metrics.illegalBoundaryBlockRate < AGENT_EVAL_THRESHOLDS.illegalBoundaryBlockRateMin) failures.push("illegal state/tool block rate");
  if (metrics.candidateCountAccuracy < AGENT_EVAL_THRESHOLDS.candidateCountAccuracyMin) failures.push("candidate count accuracy");
  if (metrics.refreshRecoveryRate < AGENT_EVAL_THRESHOLDS.refreshRecoveryRateMin) failures.push("refresh recovery rate");
  if (metrics.dashboardSensitiveLeakCount > AGENT_EVAL_THRESHOLDS.dashboardSensitiveLeakCountMax) failures.push("dashboard sensitive leakage");
  if (metrics.memoryMisuseRate > AGENT_EVAL_THRESHOLDS.memoryMisuseRateMax) failures.push("memory misuse rate");
  if (metrics.memoryDeletionImmediateRate < AGENT_EVAL_THRESHOLDS.memoryDeletionImmediateRateMin) failures.push("memory deletion immediacy");

  return {
    measurement: "offline_fixture",
    onlineProductionClaim: false,
    thresholds: AGENT_EVAL_THRESHOLDS,
    metrics,
    sampleSizes: Object.fromEntries(evidence) as AgentOfflineEvalReport["sampleSizes"],
    failures,
  };
}

export function shouldContinueAgentOptimization(input: {
  completedRounds: number;
  previousScore?: number;
  currentScore?: number;
}): boolean {
  if (input.completedRounds >= AGENT_OBJECTIVE_RUBRIC.revisionRounds.maximum) return false;
  if (input.previousScore !== undefined && input.currentScore !== undefined && input.currentScore <= input.previousScore) return false;
  return true;
}
