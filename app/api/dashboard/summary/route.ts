import { NextResponse } from "next/server";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { isCanonicalDataOrigin } from "@/lib/evaluation/origins";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { isDatabaseNotConfiguredError } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = classifyAdminAccess(await getCurrentEvaluationUser());
    if (access === "unauthenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const requested = new URL(request.url).searchParams.get("origin") ?? "real_user";
    if (!isCanonicalDataOrigin(requested)) {
      return NextResponse.json({ error: "Unsupported dataOrigin" }, { status: 400 });
    }
    const summary = await getDashboardSummary(requested);
    return NextResponse.json(summary);
  } catch (error) {
    if (isDatabaseNotConfiguredError(error)) {
      return NextResponse.json(
        { ok: false, error: "数据库未配置", message: error.message },
        { status: 503 },
      );
    }
    throw error;
  }
}
