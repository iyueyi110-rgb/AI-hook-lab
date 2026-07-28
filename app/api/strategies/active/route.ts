import { strategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return strategyHttpHandlers.listActive(request);
}
