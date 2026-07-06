import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/dashboardStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getDashboardSummary();
  return NextResponse.json(summary);
}
