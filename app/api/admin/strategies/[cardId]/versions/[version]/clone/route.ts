import { strategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string; version: string }> },
): Promise<Response> {
  const { cardId, version } = await params;
  return strategyHttpHandlers.cloneVersion(request, cardId, /^\d+$/.test(version) ? Number(version) : 0);
}
