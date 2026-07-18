import { sanitizeInternalReturnPath } from "../adminAccess";

export type EvaluationFormError = "login_failed" | "setup_failed";

export function createEvaluationFormRedirect(
  requestUrl: string,
  error?: EvaluationFormError,
): Response {
  const request = new URL(requestUrl);
  const nextPath = sanitizeInternalReturnPath(request.searchParams.get("next"));
  const destination = new URL(error ? "/evaluation/login" : nextPath, request);

  if (error) {
    destination.searchParams.set("error", error);
    destination.searchParams.set("next", nextPath);
  }

  return Response.redirect(destination, 303);
}
