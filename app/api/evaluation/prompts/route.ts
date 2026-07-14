import { NextResponse } from "next/server";

import { assertSameOrigin, getCurrentEvaluationUser, getEvaluationService } from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const prompt = await getEvaluationService().createPromptVersion(actor.id, {
      version: String(body.version ?? ""), name: String(body.name ?? ""),
      promptContent: String(body.promptContent ?? ""), changeSummary: String(body.changeSummary ?? ""),
      modelName: String(body.modelName ?? "deepseek-chat"), modelParameters: body.modelParameters ?? { temperature: 0.7 },
    });
    return NextResponse.json({ ok: true, prompt }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Prompt 创建失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action !== "set-baseline") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    const prompt = await getEvaluationService().setBaselinePrompt(actor.id, String(body.promptId ?? ""));
    return NextResponse.json({ ok: true, prompt });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Prompt 更新失败" }, { status: 400 });
  }
}
