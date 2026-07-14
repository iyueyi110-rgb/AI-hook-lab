import { NextResponse } from "next/server";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runSummary } from "@/lib/evaluation/server";
import { getEvaluationRepository } from "@/lib/evaluation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentEvaluationUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await getEvaluationService().getState();
  const visibleRuns = user.role === "admin"
    ? state.runs
    : state.runs.filter((run) => run.evaluatorIds.includes(user.id) || run.adjudicatorId === user.id);
  return NextResponse.json({
    user: publicUser(user),
    storageMode: getEvaluationRepository().mode,
    cases: user.role === "admin" ? state.cases : [],
    promptVersions: user.role === "admin" ? state.promptVersions : [],
    users: user.role === "admin" ? state.users.map(publicUser) : [publicUser(user)],
    runs: visibleRuns.map(runSummary),
  });
}
