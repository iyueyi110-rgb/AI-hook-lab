import type { EvaluationUser } from "./evaluation/types";

export type AdminAccess = "unauthenticated" | "forbidden" | "authorized";

type RoleOnlyUser = Pick<EvaluationUser, "role">;

export function classifyAdminAccess(user: RoleOnlyUser | null): AdminAccess {
  if (!user) return "unauthenticated";
  return user.role === "admin" ? "authorized" : "forbidden";
}

export function sanitizeInternalReturnPath(
  value: string | string[] | null | undefined,
  fallback = "/evaluation",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  try {
    decodeURIComponent(candidate);
    const parsed = new URL(candidate, "https://hookovo.invalid");
    const allowed =
      parsed.pathname === "/admin/dashboard" ||
      parsed.pathname === "/evaluation" ||
      parsed.pathname.startsWith("/evaluation/");
    return allowed ? `${parsed.pathname}${parsed.search}` : fallback;
  } catch {
    return fallback;
  }
}
