import { NextRequest, NextResponse } from "next/server";
import {
  ClassicRequestError,
  generateClassicHooks,
} from "@/lib/generation/hooks";
import { GenerationError, type GenerationErrorCode } from "@/lib/generation/service";
import type { GenerateRequest } from "@/lib/types";

const modelErrorResponses: Record<
  GenerationErrorCode,
  { error: string; message: string; status: number }
> = {
  missing_key: {
    error: "API Key 未配置",
    message:
      "请在项目根目录的 .env.local 文件中添加 DEEPSEEK_API_KEY=你的Key。\n获取 Key：https://platform.deepseek.com",
    status: 401,
  },
  auth: {
    error: "API Key 无效",
    message: "DEEPSEEK_API_KEY 无效，请检查 .env.local 中的 Key 是否正确",
    status: 502,
  },
  rate_limit: {
    error: "请求太频繁",
    message: "API 调用频率已达上限，请稍后再试",
    status: 429,
  },
  timeout: {
    error: "请求超时",
    message: "模型响应超时（30秒），请重试或缩短主题描述",
    status: 504,
  },
  invalid_json: {
    error: "JSON 解析失败",
    message: "AI 返回的不是有效 JSON，请重试",
    status: 500,
  },
  invalid_count: {
    error: "生成数量异常",
    message: "AI 未返回要求数量的 Hook，请重试",
    status: 500,
  },
  upstream: {
    error: "AI 服务异常",
    message: "模型服务暂时不可用，请稍后重试",
    status: 502,
  },
  internal: {
    error: "生成失败",
    message: "生成结果无法处理，请重试",
    status: 500,
  },
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const response = modelErrorResponses.missing_key;
    return NextResponse.json(
      { code: "missing_key", error: response.error, message: response.message },
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
    const response = await generateClassicHooks({
      request: body,
      apiKey,
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ClassicRequestError) {
      return NextResponse.json(
        { error: error.title, message: error.message },
        { status: 400 }
      );
    }
    if (error instanceof GenerationError) {
      const response = modelErrorResponses[error.code];
      return NextResponse.json(
        { code: error.code, error: response.error, message: response.message },
        { status: response.status }
      );
    }
    return NextResponse.json(
      { code: "internal", error: "生成失败", message: "生成结果无法处理，请重试" },
      { status: 500 }
    );
  }
}
