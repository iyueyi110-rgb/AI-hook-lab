import { NextRequest, NextResponse } from "next/server";
import { appendDashboardEvent } from "@/lib/dashboardStore";
import { isDatabaseNotConfiguredError } from "@/lib/persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const serializedPayload = JSON.stringify(body?.payload ?? {});
    if (serializedPayload.length > 10_000) {
      return NextResponse.json({ ok: false, error: "事件 payload 过大" }, { status: 413 });
    }
    const evalToken = request.headers.get("x-eval-token");
    const canWriteEvaluation = Boolean(
      process.env.EVAL_INGEST_TOKEN && evalToken === process.env.EVAL_INGEST_TOKEN
    );
    const event = await appendDashboardEvent({
      type: body?.type,
      timestamp: body?.timestamp,
      payload: body?.payload,
      dataOrigin: canWriteEvaluation && body?.dataOrigin === "simulation" ? "simulation" : canWriteEvaluation ? "evaluation_set" : "real_user",
    });
    return NextResponse.json({ ok: true, event });
  } catch (error) {
    if (isDatabaseNotConfiguredError(error)) {
      return NextResponse.json(
        { ok: false, error: "数据库未配置", message: error.message },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "事件写入失败",
        message: error instanceof Error ? error.message : "未知错误",
      },
      { status: 400 }
    );
  }
}
