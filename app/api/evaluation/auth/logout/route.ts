import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { EVALUATION_SESSION_COOKIE, getEvaluationService } from "@/lib/evaluation/server";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(EVALUATION_SESSION_COOKIE)?.value;
  if (token) await getEvaluationService().logout(token);
  cookieStore.delete(EVALUATION_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
