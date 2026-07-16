import { redirect } from "next/navigation";

import { getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";
import { EvaluationLoginClient } from "./EvaluationLoginClient";

export const dynamic = "force-dynamic";

export default async function EvaluationLoginPage() {
  const current = await getCurrentEvaluationUser();
  if (current) redirect("/evaluation");
  const state = await getEvaluationService().getState();
  return <EvaluationLoginClient setupRequired={state.users.length === 0} />;
}
