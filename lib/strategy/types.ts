import type { ContentType, Platform } from "../types.ts";
import type { DataOrigin, ExecutionMode } from "../evaluation/types.ts";

export type StrategyStatus =
  | "draft"
  | "pending_review"
  | "approved_experiment"
  | "active"
  | "rejected"
  | "archived";

export interface StrategyScopePair {
  platform: Platform;
  contentType: ContentType;
}

export interface StrategyGuidance {
  do: string[];
  avoid: string[];
}

export interface StrategyContent {
  title: string;
  scopePairs: StrategyScopePair[];
  audienceLabel?: string;
  guidance: StrategyGuidance;
  hypothesis: string;
}

export interface StrategyCardRef {
  id: string;
  version: number;
}

export interface AppliedStrategyRef extends StrategyCardRef {
  appliedGuidanceHash: string;
}

export type EvidenceEligibility =
  | "draft_only"
  | "review_support"
  | "activation_eligible";

export interface StrategyVersion extends StrategyContent {
  cardId: string;
  version: number;
  revision: number;
  status: StrategyStatus;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  archivedAt?: string;
}

export interface StrategyCard {
  id: string;
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyEvaluationMetrics {
  baselineUsabilityRate: number;
  candidateUsabilityRate: number;
  baselinePlatformFitRate: number;
  candidatePlatformFitRate: number;
  candidateWinRate: number | null;
  baselineHighSeverityBadCaseCount: number;
  candidateHighSeverityBadCaseCount: number;
  baselineAdoptionIntentRate: number;
  candidateAdoptionIntentRate: number;
  baselineFirstAttemptFormatErrorRate: number;
  candidateFirstAttemptFormatErrorRate: number;
  baselineOverLengthCount: number;
  candidateOverLengthCount: number;
}

export interface StrategyEvaluationSnapshot {
  evaluationRunId?: string;
  evaluationKind: "strategy";
  executionMode: ExecutionMode;
  status: "draft" | "running" | "completed" | "failed";
  topicSetVersion: "strategy-hook-topics-v1";
  scopePair: StrategyScopePair;
  baselineStrategyRef: null;
  candidateStrategyRef: StrategyCardRef;
  caseCount: number;
  baselineScoredResults: number;
  candidateScoredResults: number;
  pairwiseDecisionCount: number;
  generationTaskCount: number;
  allGenerationTasksSucceeded: boolean;
  metrics: StrategyEvaluationMetrics;
  completedAt?: string;
}

export interface StrategyEvidence {
  id: string;
  cardId: string;
  strategyVersion: number;
  origin: DataOrigin;
  sampleSize: number;
  feedbackResponseRate?: number;
  eligibility: EvidenceEligibility;
  sourceId?: string;
  scopePair?: StrategyScopePair;
  evaluation?: StrategyEvaluationSnapshot;
  caveats: string[];
  collectedAt: string;
}

export type StrategyReviewAction =
  | "created"
  | "updated"
  | "submit_review"
  | "approve_experiment"
  | "reject"
  | "activate"
  | "archive"
  | "clone";

export interface StrategyReview {
  id: string;
  cardId: string;
  strategyVersion: number;
  action: StrategyReviewAction;
  actorId: string;
  reason?: string;
  contentHash: string;
  createdAt: string;
}

export type StrategyFit = "helpful" | "unhelpful" | "not_applicable";
export type StrategyNotApplicableReason =
  | "platform"
  | "content_type"
  | "audience"
  | "tone"
  | "topic"
  | "other";

export interface CreativeStrategyAssignment {
  runId: string;
  cardId: string;
  strategyVersion: number;
  appliedGuidanceHash: string;
  boundAt: string;
  strategyFit?: StrategyFit;
  notApplicableReason?: StrategyNotApplicableReason;
  feedbackAt?: string;
}

export interface StrategyStoreState {
  schemaVersion: 1;
  cards: StrategyCard[];
  versions: StrategyVersion[];
  evidence: StrategyEvidence[];
  reviews: StrategyReview[];
  assignments: CreativeStrategyAssignment[];
}

export interface StrategyEvaluationReport {
  complete: boolean;
  recommendation: "recommend_activate" | "do_not_activate" | "needs_more_evaluation";
  gates: {
    usabilityImprovement: boolean;
    platformFitImprovement: boolean;
    pairwiseWinRate: boolean;
    highSeverityRegression: boolean;
    adoptionIntentRegression: boolean;
    formatErrorRegression: boolean;
    lengthRegression: boolean;
  };
}
