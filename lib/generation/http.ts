import { GenerationError } from "./service.ts";

export interface ClassicGenerationErrorResponse {
  error: string;
  message: string;
  status: number;
}

export function mapGenerationError(
  error: GenerationError
): ClassicGenerationErrorResponse {
  switch (error.code) {
    case "missing_key":
      return {
        error: "API Key 未配置",
        message:
          "请在项目根目录的 .env.local 文件中添加 DEEPSEEK_API_KEY=你的Key。\n获取 Key：https://platform.deepseek.com",
        status: 401,
      };
    case "auth":
      return {
        error: "API Key 无效",
        message: "DEEPSEEK_API_KEY 无效，请检查 .env.local 中的 Key 是否正确",
        status: 502,
      };
    case "rate_limit":
      return {
        error: "请求太频繁",
        message: "API 调用频率已达上限，请稍后再试",
        status: 429,
      };
    case "timeout":
      return {
        error: "请求超时",
        message: "模型响应超时（30秒），请重试或缩短主题描述",
        status: 504,
      };
    case "empty_response":
      return {
        error: "AI 返回为空",
        message: "模型未返回有效内容，请重试",
        status: 500,
      };
    case "invalid_json":
      return {
        error: "JSON 解析失败",
        message: "AI 返回的不是有效 JSON，请重试",
        status: 500,
      };
    case "invalid_count":
      return {
        error: "生成数量异常",
        message: "AI 未返回要求数量的 Hook，请重试",
        status: 500,
      };
    case "upstream":
      return {
        error: "AI 服务异常",
        message: error.status
          ? `模型服务返回错误（${error.status}），请稍后重试`
          : "模型服务暂时不可用，请稍后重试",
        status: 502,
      };
    case "internal":
      return {
        error: "生成失败",
        message: "生成结果无法处理，请重试",
        status: 500,
      };
  }
}
