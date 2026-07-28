import { agentHttpHandlers } from "@/lib/agent/http";

interface Context {
  params: Promise<{ runId: string }>;
}

export const runtime = "nodejs";

export async function POST(request: Request, context: Context): Promise<Response> {
  return agentHttpHandlers.strategyFeedback(request, (await context.params).runId);
}
