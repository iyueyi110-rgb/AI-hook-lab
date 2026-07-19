import { NextResponse } from "next/server";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { isCanonicalDataOrigin } from "@/lib/evaluation/origins";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { isDatabaseNotConfiguredError } from "@/lib/persistence";
import { PLATFORM_CONFIG } from "@/lib/constants";

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
    const searchParams = new URL(request.url).searchParams;
    const requested = searchParams.get("origin") ?? "real_user";
    if (!isCanonicalDataOrigin(requested)) {
      return NextResponse.json({ error: "Unsupported dataOrigin" }, { status: 400 });
    }
    const platform = searchParams.get("platform") || undefined;
    const promptVersion = searchParams.get("promptVersion") || undefined;
    const trigger = searchParams.get("trigger") || undefined;
    if (platform && !Object.hasOwn(PLATFORM_CONFIG, platform)) {
      return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
    }
    if (promptVersion && promptVersion.length > 100) {
      return NextResponse.json({ error: "Unsupported promptVersion" }, { status: 400 });
    }
    if (
      trigger &&
      ![
        "adoption",
        "explicit_batch_reject",
        "sampled_before_regenerate",
        "low_satisfaction",
      ].includes(trigger)
    ) {
      return NextResponse.json({ error: "Unsupported feedback trigger" }, { status: 400 });
    }
    const summary = await getDashboardSummary(requested, { platform, promptVersion, trigger });
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
