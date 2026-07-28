import { NextResponse } from "next/server";

import { getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { runId } = await params;
    const service = getEvaluationService();
    const report = await service.report(actor.id, runId);
    await service.persistStrategyEvidence(actor.id, runId);
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "报告生成失败" }, { status: 400 });
  }
}
