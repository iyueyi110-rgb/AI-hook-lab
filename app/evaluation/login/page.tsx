import { redirect } from "next/navigation";

import { sanitizeInternalReturnPath } from "@/lib/adminAccess";
import { getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";
import { EvaluationLoginClient } from "./EvaluationLoginClient";

export const dynamic = "force-dynamic";

export default async function EvaluationLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeInternalReturnPath(params.next);
  const current = await getCurrentEvaluationUser();
  if (current) redirect(current.role === "admin" ? nextPath : "/evaluation");
  const state = await getEvaluationService().getState();
  return <EvaluationLoginClient nextPath={nextPath} setupRequired={state.users.length === 0} />;
}
