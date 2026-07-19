import { agentHttpHandlers } from "@/lib/agent/http";

interface Context { params: Promise<{ runId: string }> }

export const runtime = "nodejs";
export const maxDuration = 40;

export async function POST(request: Request, context: Context): Promise<Response> {
  return agentHttpHandlers.turn(request, (await context.params).runId);
}
