import { redirect } from "next/navigation";

import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { sanitizeInternalReturnPath } from "@/lib/adminAccess";
import { getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { EvaluationLoginClient } from "./EvaluationLoginClient";

export const dynamic = "force-dynamic";

export default async function EvaluationLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
  const params = await searchParams;
  const nextPath = sanitizeInternalReturnPath(params.next);
  const current = await getCurrentEvaluationUser();
  if (current) redirect(current.role === "admin" ? nextPath : "/evaluation");
  const state = await getEvaluationService().getState();
  return <EvaluationLoginClient nextPath={nextPath} setupRequired={state.users.length === 0} />;
}
