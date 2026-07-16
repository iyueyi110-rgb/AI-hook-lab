import "server-only";

import { cookies } from "next/headers";

import { getEvaluationRepository } from "./repository";
import { EvaluationService } from "./service";
import type { EvaluationRunRecord, EvaluationUser } from "./types";

export const EVALUATION_SESSION_COOKIE = "ai_hook_eval_session";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new Error("Cross-origin mutation rejected");
}

let service: EvaluationService | undefined;

export function getEvaluationService(): EvaluationService {
  if (!service) service = new EvaluationService(getEvaluationRepository());
  return service;
}

export async function getCurrentEvaluationUser(): Promise<EvaluationUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(EVALUATION_SESSION_COOKIE)?.value;
  return token ? getEvaluationService().resolveSession(token) : null;
}

export function publicUser(user: EvaluationUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function runSummary(run: EvaluationRunRecord) {
  return {
    id: run.id,
    runName: run.runName,
    status: run.status,
    executionMode: run.executionMode,
    dataOrigin: run.dataOrigin,
    caseCount: run.caseCount,
    generatedTasks: run.generationTasks.filter((item) => item.terminalStatus === "success").length,
    totalGenerationTasks: run.generationTasks.length,
    candidateCount: run.candidates.length,
    selectedCount: run.formalResults.length,
    primaryReviewCount: run.rawReviews.length,
    pairwiseReviewCount: run.rawPairwiseEvaluations.length,
    adjudicationCount: run.adjudications.length,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function runForUser(run: EvaluationRunRecord, user: EvaluationUser): unknown {
  if (user.role === "admin") return run;
  if (user.role === "evaluator") {
    if (!run.evaluatorIds.includes(user.id)) throw new Error("Unauthorized");
    const assignments = run.reviewAssignments.filter((item) => item.evaluatorId === user.id);
    const formalResults = run.formalResults.map((result) => {
      const assignment = assignments.find((item) => item.caseId === result.caseId)!;
      const blindLabel = assignment?.optionA === result.promptRole ? "A" : "B";
      const candidate = run.candidates.find((item) => item.selected && item.caseId === result.caseId && item.promptRole === result.promptRole);
      return {
        id: result.id,
        caseId: result.caseId,
        platform: result.platform,
        blindLabel,
        content: candidate?.content,
        styleTag: candidate?.styleTag,
        recommendReason: candidate?.recommendReason,
        overLength: candidate?.overLength,
        myReview: run.rawReviews.find((item) => item.formalResultId === result.id && item.evaluatorId === user.id),
      };
    });
    return {
      ...runSummary(run),
      cases: run.cases,
      formalResults,
      assignments,
      myPairwise: run.rawPairwiseEvaluations.filter((item) => item.evaluatorId === user.id),
    };
  }
  if (run.adjudicatorId !== user.id) throw new Error("Unauthorized");
  return {
    ...runSummary(run),
    cases: run.cases,
    formalResults: run.formalResults.map((result) => {
      const candidate = run.candidates.find((item) => item.selected && item.caseId === result.caseId && item.promptRole === result.promptRole);
      const paired = run.formalResults.filter((item) => item.caseId === result.caseId).sort((a, b) => a.id.localeCompare(b.id));
      return { ...result, promptRole: undefined, blindLabel: paired[0]?.id === result.id ? "A" : "B", content: candidate?.content, modelScore: undefined };
    }),
    pairwiseDecisions: run.pairwiseDecisions,
    adjudications: run.adjudications,
  };
}
