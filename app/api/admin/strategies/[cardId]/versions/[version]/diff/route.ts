import { strategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cardId: string; version: string }> },
): Promise<Response> {
  const { cardId, version } = await params;
  return strategyHttpHandlers.diffVersion(request, cardId, /^\d+$/.test(version) ? Number(version) : 0);
}
