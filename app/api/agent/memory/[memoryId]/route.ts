import { agentHttpHandlers } from "@/lib/agent/http";

interface Context { params: Promise<{ memoryId: string }> }

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return agentHttpHandlers.deleteMemory(request, (await context.params).memoryId);
}
