import { redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runSummary } from "@/lib/evaluation/server";
import { getEvaluationRepository } from "@/lib/evaluation/repository";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
import { isPublicWorkspaceReadEnabled } from "@/lib/adminAccess";
import { EvaluationClient } from "./EvaluationClient";

export const dynamic = "force-dynamic";

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentEvaluationUser();
  const publicRead = isPublicWorkspaceReadEnabled();
  if (!user && !publicRead) redirect("/evaluation/login");
  const query = await searchParams;
  const strategyTarget = (
    typeof query.strategyCardId === "string"
    && typeof query.strategyCardVersion === "string"
    && typeof query.platform === "string"
    && typeof query.contentType === "string"
  ) ? {
    id: query.strategyCardId,
    version: Number(query.strategyCardVersion),
    platform: query.platform,
    contentType: query.contentType,
  } : undefined;
  const state = await getEvaluationService().getState();
  const canManage = user?.role === "admin";
  const runs = !user || canManage ? state.runs : state.runs.filter((run) => run.evaluatorIds.includes(user.id) || run.adjudicatorId === user.id);
  return <EvaluationClient strategyTarget={strategyTarget} initial={{
    user: user ? publicUser(user) : null, storageMode: getEvaluationRepository().mode,
    cases: canManage ? state.cases : [],
    promptVersions: canManage ? state.promptVersions : [],
    users: canManage ? state.users.map(publicUser) : user ? [publicUser(user)] : [],
    runs: runs.map(runSummary),
  }} adminNavigation={canManage || publicRead ? {
    opsAgentEnabled: isOpsAgentEnabled(),
    strategyCardsEnabled: isStrategyCardsEnabled(),
  } : undefined} />;
}
