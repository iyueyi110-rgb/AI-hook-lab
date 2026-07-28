import { createStrategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";
export const maxDuration = 25;

export async function POST(request: Request): Promise<Response> {
  return createStrategyHttpHandlers().createDraftFromOps(request);
}
