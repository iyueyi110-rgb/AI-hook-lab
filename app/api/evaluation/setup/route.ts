import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { assertSameOrigin, EVALUATION_SESSION_COOKIE, getEvaluationService, publicUser } from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
    const body = isForm ? Object.fromEntries(await request.formData()) : await request.json();
    const service = getEvaluationService();
    const user = await service.setupFirstAdmin(String(body.username ?? ""), String(body.displayName ?? ""), String(body.password ?? ""));
    const session = await service.authenticate(user.username, String(body.password ?? ""));
    const cookieStore = await cookies();
    cookieStore.set(EVALUATION_SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      expires: new Date(session.expiresAt), path: "/",
    });
    return isForm ? NextResponse.redirect(new URL("/evaluation", request.url), 303) : NextResponse.json({ ok: true, user: publicUser(session.user) });
  } catch (error) {
    const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
    return isForm
      ? NextResponse.redirect(new URL("/evaluation/login?error=setup_failed", request.url), 303)
      : NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "初始化失败" }, { status: 400 });
  }
}
