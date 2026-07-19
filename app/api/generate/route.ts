import { NextRequest, NextResponse } from "next/server";
import {
  ClassicRequestError,
  generateClassicHooks,
} from "@/lib/generation/hooks";
import { mapGenerationError } from "@/lib/generation/http";
import { GenerationError } from "@/lib/generation/service";
import type { GenerateRequest } from "@/lib/types";

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const response = mapGenerationError(new GenerationError("missing_key"));
    return NextResponse.json(
      { error: response.error, message: response.message },
      { status: response.status }
    );
  }

  let body: GenerateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式错误", message: "请提供有效的 JSON 请求体" },
      { status: 400 }
    );
  }

  try {
    const response = await generateClassicHooks({ request: body, apiKey });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ClassicRequestError) {
      return NextResponse.json(
        { error: error.title, message: error.message },
        { status: 400 }
      );
    }
    if (error instanceof GenerationError) {
      const response = mapGenerationError(error);
      return NextResponse.json(
        { error: response.error, message: response.message },
        { status: response.status }
      );
    }
    return NextResponse.json(
      { error: "生成失败", message: "生成结果无法处理，请重试" },
      { status: 500 }
    );
  }
}
