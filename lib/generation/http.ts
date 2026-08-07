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
        error: "生成服务暂不可用",
        message: "生成服务尚未完成配置，请稍后重试或联系维护者。",
        status: 503,
      };
    case "auth":
      return {
        error: "生成服务暂不可用",
        message: "生成服务认证失败，请稍后重试或联系维护者。",
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
        message: "生成等待时间较长，请重试；你的主题和选项已保留。",
        status: 504,
      };
    case "empty_response":
      return {
        error: "生成结果异常",
        message: "本次没有获得有效结果，请重试。",
        status: 500,
      };
    case "invalid_json":
      return {
        error: "生成结果异常",
        message: "本次结果未能正确处理，请重试。",
        status: 500,
      };
    case "invalid_count":
      return {
        error: "生成结果不完整",
        message: "本次未生成完整的 10 条候选，请重试。",
        status: 500,
      };
    case "upstream":
      return {
        error: "生成服务繁忙",
        message: "模型服务暂时不可用，请稍后重试。",
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
