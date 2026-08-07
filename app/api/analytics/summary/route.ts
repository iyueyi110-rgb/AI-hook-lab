import { NextResponse } from "next/server";

import {
  listCandidateFunnelRows,
  summarizeCandidateFunnel,
} from "@/lib/candidateAnalytics";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { isDatabaseNotConfiguredError } from "@/lib/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getCurrentEvaluationUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const rows = await listCandidateFunnelRows({ limit: 50_000 });
    return NextResponse.json(summarizeCandidateFunnel(rows), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isDatabaseNotConfiguredError(error)) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "Analytics unavailable" }, { status: 500 });
  }
}
