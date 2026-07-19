import { opsAgentHttpHandlers } from "@/lib/agent/ops-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 65;

export async function GET(request: Request): Promise<Response> {
  return opsAgentHttpHandlers.get(request);
}

export async function POST(request: Request): Promise<Response> {
  return opsAgentHttpHandlers.post(request);
}
