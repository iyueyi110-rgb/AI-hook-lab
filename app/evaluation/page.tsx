import { redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runSummary } from "@/lib/evaluation/server";
import { getEvaluationRepository } from "@/lib/evaluation/repository";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
import { EvaluationClient } from "./EvaluationClient";

export const dynamic = "force-dynamic";

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentEvaluationUser();
  if (!user) redirect("/evaluation/login");
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
  const runs = user.role === "admin" ? state.runs : state.runs.filter((run) => run.evaluatorIds.includes(user.id) || run.adjudicatorId === user.id);
  return <EvaluationClient strategyTarget={strategyTarget} initial={{
    user: publicUser(user), storageMode: getEvaluationRepository().mode,
    cases: user.role === "admin" ? state.cases : [],
    promptVersions: user.role === "admin" ? state.promptVersions : [],
    users: user.role === "admin" ? state.users.map(publicUser) : [publicUser(user)],
    runs: runs.map(runSummary),
  }} adminNavigation={user.role === "admin" ? {
    opsAgentEnabled: isOpsAgentEnabled(),
    strategyCardsEnabled: isStrategyCardsEnabled(),
  } : undefined} />;
}
