import { NextResponse } from "next/server";

import { buildRunExportFiles } from "@/lib/evaluation/export";
import { buildEvaluationReport } from "@/lib/evaluation/metrics";
import { getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await getCurrentEvaluationUser();
  if (!actor || actor.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { runId } = await params;
  const state = await getEvaluationService().getState();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const files = buildRunExportFiles(run, buildEvaluationReport(run));
  const filename = new URL(request.url).searchParams.get("file");
  if (!filename) return NextResponse.json({ files: Object.keys(files) });
  if (!files[filename]) return NextResponse.json({ error: "Unsupported export file" }, { status: 400 });
  const contentType = filename.endsWith(".csv") ? "text/csv; charset=utf-8" : filename.endsWith(".json") ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";
  return new NextResponse(files[filename], { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` } });
}
