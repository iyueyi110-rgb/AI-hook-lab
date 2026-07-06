import { NextRequest, NextResponse } from "next/server";
import { appendDashboardEvent } from "@/lib/dashboardStore";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const event = await appendDashboardEvent({
      type: body?.type,
      timestamp: body?.timestamp,
      payload: body?.payload,
    });
    return NextResponse.json({ ok: true, event });
  } catch (error) {
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
