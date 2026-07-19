import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { assertSameOrigin, EVALUATION_SESSION_COOKIE, getEvaluationService, publicUser } from "@/lib/evaluation/server";
import { createEvaluationFormRedirect } from "@/lib/evaluation/formRedirect";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
    const body = isForm ? Object.fromEntries(await request.formData()) : await request.json();
    const result = await getEvaluationService().authenticate(String(body.username ?? ""), String(body.password ?? ""));
    const cookieStore = await cookies();
    cookieStore.set(EVALUATION_SESSION_COOKIE, result.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      expires: new Date(result.expiresAt), path: "/",
    });
    return isForm ? createEvaluationFormRedirect(request.url) : NextResponse.json({ ok: true, user: publicUser(result.user) });
  } catch (error) {
    const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") || request.headers.get("content-type")?.includes("multipart/form-data");
    return isForm
      ? createEvaluationFormRedirect(request.url, "login_failed")
      : NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "登录失败" }, { status: 401 });
  }
}
