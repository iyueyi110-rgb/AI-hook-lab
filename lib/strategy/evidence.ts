import type {
  EvidenceEligibility,
  StrategyEvidence,
  StrategyEvaluationReport,
  StrategyEvaluationSnapshot,
  StrategyScopePair,
  StrategyVersion,
} from "./types.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

export function classifyStrategyEvidence(input: {
  origin: StrategyEvidence["origin"];
  sampleSize: number;
  feedbackResponseRate?: number;
  evaluation?: StrategyEvaluationSnapshot;
  collectedAt: string;
}): { eligibility: EvidenceEligibility; caveats: string[] } {
  if (input.origin === "simulation") {
    return { eligibility: "draft_only", caveats: ["模拟数据只能支持草稿和离线实验审批。"] };
  }
  if (input.origin === "real_user") {
    if (input.sampleSize >= 30 && (input.feedbackResponseRate ?? 0) >= 50) {
      return { eligibility: "review_support", caveats: ["观察性真实用户数据不能单独支持策略激活。"] };
    }
    return { eligibility: "draft_only", caveats: ["真实用户完成任务或反馈响应率未达到复盘门槛。"] };
  }
  if (!input.evaluation) return { eligibility: "draft_only", caveats: ["缺少策略评测快照。"] };
  const report = evaluateStrategyScope(input.evaluation);
  if (report.recommendation === "recommend_activate") return { eligibility: "activation_eligible", caveats: [] };
  if (report.recommendation === "do_not_activate") return { eligibility: "review_support", caveats: ["完整评测未通过全部激活门禁。"] };
  return { eligibility: "draft_only", caveats: ["评测为 Mock、未完成或未覆盖完整 20 个主题。"] };
}

export function evaluateStrategyScope(snapshot: StrategyEvaluationSnapshot): StrategyEvaluationReport {
  const metrics = snapshot.metrics;
  const gates = {
    usabilityImprovement: metrics.candidateUsabilityRate > metrics.baselineUsabilityRate,
    platformFitImprovement: metrics.candidatePlatformFitRate - metrics.baselinePlatformFitRate >= 8,
    pairwiseWinRate: metrics.candidateWinRate !== null && metrics.candidateWinRate > 55,
    highSeverityRegression: metrics.candidateHighSeverityBadCaseCount <= metrics.baselineHighSeverityBadCaseCount,
    adoptionIntentRegression: metrics.candidateAdoptionIntentRate >= metrics.baselineAdoptionIntentRate,
    formatErrorRegression: metrics.candidateFirstAttemptFormatErrorRate <= metrics.baselineFirstAttemptFormatErrorRate,
    lengthRegression: metrics.candidateOverLengthCount <= metrics.baselineOverLengthCount,
  };
  const complete =
    snapshot.executionMode === "live" &&
    snapshot.status === "completed" &&
    snapshot.topicSetVersion === "strategy-hook-topics-v1" &&
    snapshot.caseCount === 20 &&
    snapshot.baselineScoredResults === 20 &&
    snapshot.candidateScoredResults === 20 &&
    snapshot.pairwiseDecisionCount === 20 &&
    snapshot.generationTaskCount === 40 &&
    snapshot.allGenerationTasksSucceeded &&
    Boolean(snapshot.completedAt);
  return {
    complete,
    recommendation: !complete
      ? "needs_more_evaluation"
      : Object.values(gates).every(Boolean)
        ? "recommend_activate"
        : "do_not_activate",
    gates,
  };
}

function pairKey(pair: StrategyScopePair): string {
  return `${pair.platform}:${pair.contentType}`;
}

export function activationReadiness(
  version: StrategyVersion,
  evidence: StrategyEvidence[],
  now = new Date(),
): { ready: boolean; missingScopePairs: StrategyScopePair[]; evidenceIds: string[] } {
  if (version.status !== "approved_experiment") {
    return { ready: false, missingScopePairs: [...version.scopePairs], evidenceIds: [] };
  }
  const relevant = evidence.filter((item) =>
    item.cardId === version.cardId &&
    item.strategyVersion === version.version &&
    item.origin === "evaluation_set" &&
    item.scopePair &&
    item.evaluation,
  );
  const selected: StrategyEvidence[] = [];
  const missingScopePairs = version.scopePairs.filter((scope) => {
    const matching = relevant
      .filter((item) => pairKey(item.scopePair!) === pairKey(scope))
      .sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
    const latest = matching[0];
    if (!latest) return true;
    const fresh = Number.isFinite(Date.parse(latest.collectedAt)) &&
      now.getTime() - Date.parse(latest.collectedAt) <= THIRTY_DAYS_MS &&
      Date.parse(latest.collectedAt) <= now.getTime();
    const exactRef = latest.evaluation?.candidateStrategyRef.id === version.cardId &&
      latest.evaluation?.candidateStrategyRef.version === version.version;
    if (!fresh || !exactRef || evaluateStrategyScope(latest.evaluation!).recommendation !== "recommend_activate") return true;
    selected.push(latest);
    return false;
  });
  return { ready: missingScopePairs.length === 0, missingScopePairs, evidenceIds: selected.map((item) => item.id) };
}
