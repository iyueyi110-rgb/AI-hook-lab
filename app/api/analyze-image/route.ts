import { handleAnalyzeImageRequest } from "@/lib/imageAnalysis";

export const runtime = "nodejs";
export const maxDuration = 35;

export async function POST(request: Request): Promise<Response> {
  return handleAnalyzeImageRequest(request, {
    apiKey: process.env.ARK_API_KEY,
    model: process.env.ARK_MODEL_ID,
  });
}
