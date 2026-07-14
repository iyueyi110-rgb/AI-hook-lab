export type DataOrigin = "real_user" | "evaluation_set" | "simulation";
export type ExecutionMode = "live" | "mock";
export type UserRole = "admin" | "evaluator" | "adjudicator";
export type EvaluationPlatform = "xiaohongshu" | "douyin" | "bilibili";
export type PromptRole = "baseline" | "candidate";
export type RunStatus =
  | "draft"
  | "generating"
  | "generated"
  | "selecting"
  | "reviewing"
  | "adjudicating"
  | "completed"
  | "failed";
export type UpgradeRecommendation =
  | "recommend_upgrade"
  | "do_not_upgrade"
  | "needs_more_evaluation";
export type BadCaseSeverity = "low" | "medium" | "high";
export type PairwiseWinner = "baseline" | "candidate" | "tie";

export interface EvaluationCase {
  id: string;
  caseId: string;
  datasetVersion: string;
  topicId: string;
  topic: string;
  category: string;
  platform: EvaluationPlatform;
  platformLabel: string;
  targetAudience: string;
  emotionStyle: string;
  lengthLimit: number;
  dataOrigin: "evaluation_set";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  version: string;
  name: string;
  role: PromptRole | "released" | "archived";
  promptContent: string;
  changeSummary: string;
  modelName: string;
  modelParameters: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
}

export interface EvaluationUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  status: "active" | "disabled";
  failedLoginCount: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface EvaluationGenerationTask {
  id: string;
  caseId: string;
  promptRole: PromptRole;
  firstAttemptFormatError: boolean;
  terminalStatus: "pending" | "success" | "format_error" | "generation_error";
  attemptCount?: number;
  lastError?: string;
  rawResponses?: unknown[];
}

export interface HumanReviewScore {
  evaluatorId: string;
  usabilityScore: number;
  platformFitScore: number;
  attractivenessScore: number;
  reasonQualityScore: number;
  favoriteIntent: boolean;
  adoptionIntent: boolean;
}

export interface FormalEvaluationResult {
  id: string;
  caseId: string;
  platform: EvaluationPlatform;
  promptRole: PromptRole;
  overLength: boolean;
  highSeverityBadCaseTypes: string[];
  badCaseTypes?: string[];
  reviews: HumanReviewScore[];
  adjudicatedFavoriteIntent?: boolean;
  adjudicatedAdoptionIntent?: boolean;
}

export interface PairwiseDecision {
  caseId: string;
  winnerRole?: PairwiseWinner;
}

export interface EvaluationRunSnapshot {
  id: string;
  runName: string;
  dataOrigin: "evaluation_set";
  executionMode: ExecutionMode;
  status: RunStatus;
  caseCount: number;
  baselinePromptVersion: string;
  candidatePromptVersion: string;
  modelName: string;
  modelParameters: Record<string, unknown>;
  generationTasks: EvaluationGenerationTask[];
  formalResults: FormalEvaluationResult[];
  pairwiseDecisions: PairwiseDecision[];
}

export interface EvaluationCandidate {
  id: string;
  generationTaskId: string;
  caseId: string;
  promptRole: PromptRole;
  candidateIndex: number;
  content: string;
  styleTag: string;
  recommendReason: string;
  modelScore?: number;
  overLength: boolean;
  duplicateRisk: boolean;
  selected: boolean;
  generationStatus: "success" | "format_error" | "generation_error";
  rawResponse?: unknown;
  dataOrigin: "evaluation_set";
  createdAt: string;
}

export interface ReviewAssignment {
  id: string;
  runId: string;
  caseId: string;
  evaluatorId: string;
  optionA: PromptRole;
  optionB: PromptRole;
  createdAt: string;
}

export interface HumanEvaluationRecord extends HumanReviewScore {
  id: string;
  runId: string;
  formalResultId: string;
  caseId: string;
  promptRole: PromptRole;
  evaluatorNote?: string;
  badCases: Array<{ type: string; severity: BadCaseSeverity; description?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface PairwiseEvaluationRecord {
  id: string;
  runId: string;
  caseId: string;
  evaluatorId: string;
  winner: "A" | "B" | "tie";
  comparisonReason?: string;
  createdAt: string;
}

export interface AdjudicationRecord {
  id: string;
  runId: string;
  caseId: string;
  formalResultId?: string;
  adjudicatorId: string;
  favoriteIntent?: boolean;
  adoptionIntent?: boolean;
  pairwiseWinner?: PairwiseWinner;
  reason: string;
  createdAt: string;
}

export interface BadCaseRecord {
  id: string;
  runId: string;
  formalResultId: string;
  generationId: string;
  type: string;
  severity: BadCaseSeverity;
  description?: string;
  rootCause?: string;
  improvementAction?: string;
  dataOrigin: "evaluation_set";
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRunRecord extends EvaluationRunSnapshot {
  datasetVersion: string;
  cases: EvaluationCase[];
  baselinePromptId: string;
  candidatePromptId: string;
  baselinePromptContent: string;
  candidatePromptContent: string;
  snapshotHash: string;
  evaluatorIds: [string, string];
  adjudicatorId: string;
  candidates: EvaluationCandidate[];
  reviewAssignments: ReviewAssignment[];
  rawReviews: HumanEvaluationRecord[];
  rawPairwiseEvaluations: PairwiseEvaluationRecord[];
  adjudications: AdjudicationRecord[];
  badCases: BadCaseRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface EvaluationState {
  schemaVersion: number;
  users: EvaluationUser[];
  sessions: EvaluationSession[];
  cases: EvaluationCase[];
  promptVersions: PromptVersion[];
  runs: EvaluationRunRecord[];
  auditLog: AuditEntry[];
}

export interface GateResult {
  passed: boolean;
  actual: number | null;
  threshold: string;
}

export interface EvaluationReport {
  recommendation: UpgradeRecommendation;
  recommendationReason: string;
  versions: Record<PromptRole, {
    scoredResults: number;
    usabilityRate: number;
    platformFitRate: number;
    favoriteIntentRate: number;
    adoptionIntentRate: number;
    averageAttractiveness: number;
    averageReasonQuality: number;
    highSeverityBadCaseCount: number;
    overLengthCount: number;
    firstAttemptFormatErrorRate: number;
  }>;
  pairwise: {
    totalCases: number;
    candidateWins: number;
    baselineWins: number;
    ties: number;
    tieRate: number;
    candidateWinRate: number | null;
  };
  platforms: Record<EvaluationPlatform, {
    baseline: EvaluationReport["versions"]["baseline"];
    candidate: EvaluationReport["versions"]["candidate"];
    candidateWinRate: number | null;
    ties: number;
  }>;
  badCaseComparison: Array<{
    type: string;
    baseline: number;
    candidate: number;
    changeRate: number | null;
    changeLabel: string;
  }>;
  gates: {
    usabilityImprovement: GateResult;
    platformFitImprovement: GateResult;
    pairwiseWinRate: GateResult;
    highSeverityRegression: GateResult;
    platformUsabilityRegression: GateResult;
    formatErrorRegression: GateResult;
    lengthRegression: GateResult;
  };
}

export const BAD_CASE_TYPES = [
  "too_broad",
  "platform_tone_mismatch",
  "off_topic",
  "formulaic_expression",
  "weak_opening",
  "vague_reason",
  "over_length",
  "duplicate_candidates",
  "factual_risk",
  "unnatural_expression",
  "format_error",
  "other",
] as const;
