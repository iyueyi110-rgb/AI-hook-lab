import { NextResponse } from "next/server";

import { assertSameOrigin, getCurrentEvaluationUser, getEvaluationService, runSummary } from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const run = await getEvaluationService().createRun(actor.id, {
      runName: String(body.runName ?? ""), executionMode: body.executionMode,
      evaluatorIds: body.evaluatorIds, adjudicatorId: String(body.adjudicatorId ?? ""),
      modelName: String(body.modelName ?? "deepseek-chat"),
      modelParameters: body.modelParameters ?? { temperature: 0.7 },
      caseIds: body.caseIds, baselinePromptId: body.baselinePromptId, candidatePromptId: body.candidatePromptId,
    });
    return NextResponse.json({ ok: true, run: runSummary(run) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "批次创建失败" }, { status: 400 });
  }
}
