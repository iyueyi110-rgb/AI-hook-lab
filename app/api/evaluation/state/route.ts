import { NextResponse } from "next/server";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runSummary } from "@/lib/evaluation/server";
import { getEvaluationRepository } from "@/lib/evaluation/repository";
import { isPublicWorkspaceReadEnabled } from "@/lib/adminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentEvaluationUser();
  const publicRead = isPublicWorkspaceReadEnabled();
  if (!user && !publicRead) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await getEvaluationService().getState();
  const visibleRuns = !user || user.role === "admin"
    ? state.runs
    : state.runs.filter((run) => run.evaluatorIds.includes(user.id) || run.adjudicatorId === user.id);
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    storageMode: getEvaluationRepository().mode,
    cases: user?.role === "admin" ? state.cases : [],
    promptVersions: user?.role === "admin" ? state.promptVersions : [],
    users: user?.role === "admin" ? state.users.map(publicUser) : user ? [publicUser(user)] : [],
    runs: visibleRuns.map(runSummary),
  });
}
