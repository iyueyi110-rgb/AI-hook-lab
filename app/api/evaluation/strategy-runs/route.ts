import { NextResponse } from "next/server";

import {
  assertSameOrigin,
  getCurrentEvaluationUser,
  getEvaluationService,
  runSummary,
} from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const allowed = new Set([
      "runName",
      "evaluatorIds",
      "adjudicatorId",
      "modelName",
      "modelParameters",
      "baselinePromptId",
      "strategyRef",
      "scopePair",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      throw new Error("Unsupported field");
    }
    const run = await getEvaluationService().createStrategyRun(actor.id, {
      runName: String(body.runName ?? ""),
      executionMode: "live",
      evaluatorIds: body.evaluatorIds as [string, string],
      adjudicatorId: String(body.adjudicatorId ?? ""),
      modelName: String(body.modelName ?? "deepseek-chat"),
      modelParameters: body.modelParameters as Record<string, unknown> ?? {
        temperature: 0.7,
        max_tokens: 2048,
      },
      baselinePromptId: body.baselinePromptId as string | undefined,
      strategyRef: body.strategyRef as { id: string; version: number },
      scopePair: body.scopePair as {
        platform: "xiaohongshu" | "douyin" | "bilibili" | "youtube" | "x";
        contentType: "video" | "image-text" | "product-ad" | "tutorial" | "opinion";
      },
    });
    return NextResponse.json({ ok: true, run: runSummary(run) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "策略评测创建失败" },
      { status: 400 },
    );
  }
}
