import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { isCanonicalDataOrigin } from "@/lib/evaluation/origins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("origin") ?? "real_user";
  if (!isCanonicalDataOrigin(requested)) {
    return NextResponse.json({ error: "Unsupported dataOrigin" }, { status: 400 });
  }
  const summary = await getDashboardSummary(requested);
  return NextResponse.json(summary);
}
