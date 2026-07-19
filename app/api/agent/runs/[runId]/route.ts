import { agentHttpHandlers } from "@/lib/agent/http";

interface Context { params: Promise<{ runId: string }> }

export async function GET(request: Request, context: Context): Promise<Response> {
  return agentHttpHandlers.getRun(request, (await context.params).runId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return agentHttpHandlers.deleteRun(request, (await context.params).runId);
}
