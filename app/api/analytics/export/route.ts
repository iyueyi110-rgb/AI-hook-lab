import { NextResponse } from "next/server";

import {
  candidateRowsToCsv,
  listCandidateFunnelRows,
} from "@/lib/candidateAnalytics";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { isDatabaseNotConfiguredError } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentEvaluationUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limitValue = new URL(request.url).searchParams.get("limit");
  const parsedLimit = limitValue ? Number(limitValue) : undefined;
  const limit = Number.isFinite(parsedLimit) ? Math.floor(parsedLimit as number) : 5000;

  try {
    const rows = await listCandidateFunnelRows({ limit });
    const csv = candidateRowsToCsv(rows);
    return new Response(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-hook-candidate-funnel-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isDatabaseNotConfiguredError(error)) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
