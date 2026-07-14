import { notFound, redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService, publicUser, runForUser } from "@/lib/evaluation/server";
import type { EvaluationRunRecord } from "@/lib/evaluation/types";
import { RunDetailClient } from "./RunDetailClient";

export const dynamic = "force-dynamic";

export default async function EvaluationRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentEvaluationUser();
  if (!user) redirect("/evaluation/login");
  const { runId } = await params;
  const state = await getEvaluationService().getState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) notFound();
  return <RunDetailClient initialRun={runForUser(run, user) as EvaluationRunRecord} user={publicUser(user)} />;
}
