import { agentHttpHandlers } from "@/lib/agent/http";

export async function GET(request: Request): Promise<Response> {
  return agentHttpHandlers.getMemory(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return agentHttpHandlers.clearMemory(request);
}
