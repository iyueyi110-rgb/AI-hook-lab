import { NextResponse } from "next/server";

import { assertSameOrigin, getCurrentEvaluationUser, getEvaluationService, runForUser } from "@/lib/evaluation/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { runId } = await params;
    const state = await getEvaluationService().getState();
    const run = state.runs.find((item) => item.id === runId);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run: runForUser(run, actor) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 403 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { runId } = await params;
    const body = await request.json();
    const service = getEvaluationService();
    let run;
    switch (body.action) {
      case "generate-next":
        run = await service.generateNext(actor.id, runId);
        break;
      case "select-candidate":
        run = await service.selectCandidate(actor.id, runId, String(body.candidateId));
        break;
      case "retry-generation":
        run = await service.retryGenerationTask(actor.id, runId, String(body.taskId));
        break;
      case "submit-review":
        run = await service.submitReview(actor.id, runId, String(body.formalResultId), body.review, body.evaluatorId ?? actor.id);
        break;
      case "submit-pairwise":
        run = await service.submitPairwise(actor.id, runId, String(body.caseId), body.winner, body.comparisonReason);
        break;
      case "adjudicate":
        if (body.adjudication?.pairwiseWinnerLabel && !body.adjudication?.pairwiseWinner) {
          const state = await service.getState();
          const sourceRun = state.runs.find((item) => item.id === runId);
          if (!sourceRun) throw new Error("Evaluation run not found");
          const results = sourceRun.formalResults.filter((item) => item.caseId === body.adjudication.caseId).sort((a, b) => a.id.localeCompare(b.id));
          const selected = body.adjudication.pairwiseWinnerLabel === "tie" ? "tie" : results[body.adjudication.pairwiseWinnerLabel === "A" ? 0 : 1]?.promptRole;
          body.adjudication.pairwiseWinner = selected;
          delete body.adjudication.pairwiseWinnerLabel;
        }
        run = await service.adjudicate(actor.id, runId, body.adjudication);
        break;
      case "review-bad-case":
        run = await service.reviewBadCase(actor.id, runId, String(body.badCaseId), {
          rootCause: String(body.rootCause ?? ""), improvementAction: String(body.improvementAction ?? ""),
        });
        break;
      default:
        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, run: runForUser(run, actor) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "操作失败" }, { status: 400 });
  }
}
