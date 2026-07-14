import { redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runSummary } from "@/lib/evaluation/server";
import { getEvaluationRepository } from "@/lib/evaluation/repository";
import { EvaluationClient } from "./EvaluationClient";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  const user = await getCurrentEvaluationUser();
  if (!user) redirect("/evaluation/login");
  const state = await getEvaluationService().getState();
  const runs = user.role === "admin" ? state.runs : state.runs.filter((run) => run.evaluatorIds.includes(user.id) || run.adjudicatorId === user.id);
  return <EvaluationClient initial={{
    user: publicUser(user), storageMode: getEvaluationRepository().mode,
    cases: user.role === "admin" ? state.cases : [],
    promptVersions: user.role === "admin" ? state.promptVersions : [],
    users: user.role === "admin" ? state.users.map(publicUser) : [publicUser(user)],
    runs: runs.map(runSummary),
  }} />;
}
