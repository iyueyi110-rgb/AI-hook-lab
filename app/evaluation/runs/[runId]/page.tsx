import { notFound, redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runForPublic, runForUser } from "@/lib/evaluation/server";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
import { isPublicWorkspaceReadEnabled } from "@/lib/adminAccess";
import type { EvaluationRunRecord } from "@/lib/evaluation/types";
import { RunDetailClient } from "./RunDetailClient";

export const dynamic = "force-dynamic";

export default async function EvaluationRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentEvaluationUser();
  const publicRead = isPublicWorkspaceReadEnabled();
  if (!user && !publicRead) redirect("/evaluation/login");
  const { runId } = await params;
  const state = await getEvaluationService().getState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) notFound();
  return <RunDetailClient initialRun={(user ? runForUser(run, user) : runForPublic(run)) as EvaluationRunRecord} user={user ? publicUser(user) : null} adminNavigation={user?.role === "admin" || publicRead ? {
    opsAgentEnabled: isOpsAgentEnabled(),
    strategyCardsEnabled: isStrategyCardsEnabled(),
  } : undefined} />;
}
