import { NextResponse } from "next/server";

import { assertSameOrigin, getCurrentEvaluationUser, getEvaluationService, publicUser } from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const user = await getEvaluationService().createUser(actor.id, {
      username: String(body.username ?? ""), displayName: String(body.displayName ?? ""),
      password: String(body.password ?? ""), role: body.role,
    });
    return NextResponse.json({ ok: true, user: publicUser(user) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "账号创建失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  assertSameOrigin(request);
  const actor = await getCurrentEvaluationUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const user = await getEvaluationService().updateUser(actor.id, String(body.userId ?? ""), {
      status: body.status,
      password: body.password ? String(body.password) : undefined,
    });
    return NextResponse.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "账号更新失败" }, { status: 400 });
  }
}
