import { handleClassicGenerateRequest } from "@/lib/generation/classic-http";

export const runtime = "nodejs";
export const maxDuration = 35;

export async function POST(request: Request): Promise<Response> {
  return handleClassicGenerateRequest(request);
}
