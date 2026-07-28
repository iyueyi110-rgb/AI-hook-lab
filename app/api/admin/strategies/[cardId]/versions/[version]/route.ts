import { strategyHttpHandlers } from "@/lib/strategy/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ cardId: string; version: string }>;
}

function parseVersion(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : 0;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { cardId, version } = await context.params;
  return strategyHttpHandlers.getVersion(request, cardId, parseVersion(version));
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { cardId, version } = await context.params;
  return strategyHttpHandlers.patchVersion(request, cardId, parseVersion(version));
}
