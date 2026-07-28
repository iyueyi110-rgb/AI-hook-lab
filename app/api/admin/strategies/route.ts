import { strategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return strategyHttpHandlers.listAdmin();
}

export async function POST(request: Request): Promise<Response> {
  return strategyHttpHandlers.createDraft(request);
}
