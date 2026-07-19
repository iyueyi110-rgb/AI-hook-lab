import { agentHttpHandlers } from "@/lib/agent/http";

export const runtime = "nodejs";
export const maxDuration = 35;

export async function POST(request: Request): Promise<Response> {
  return agentHttpHandlers.cleanup(request);
}
