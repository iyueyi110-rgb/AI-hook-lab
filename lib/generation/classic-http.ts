import { AgentQuotaError, consumeIpQuota } from "../agent/quota.ts";
import {
  getAgentRepository,
  type AgentRepository,
} from "../agent/repository.ts";
import { DatabaseNotConfiguredError } from "../persistence.ts";
import {
  digestTrustedClientIp,
  RequestIdentityConfigError,
} from "../requestIdentity.ts";
import type { GenerateRequest } from "../types.ts";
import {
  ClassicRequestError,
  generateClassicHooks,
  normalizeClassicRequest,
} from "./hooks.ts";
import { mapGenerationError } from "./http.ts";
import { classicGenerationQuotaFromEnv } from "./quota.ts";
import { GenerationError } from "./service.ts";

interface ClassicGenerateHandlerOptions {
  env?: NodeJS.ProcessEnv;
  production?: boolean;
  repository?: AgentRepository;
  now?: () => Date;
  generate?: typeof generateClassicHooks;
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function providerError(error: GenerationError): Response {
  const response = mapGenerationError(error);
  return json(
    { error: response.error, message: response.message },
    response.status,
  );
}

function unavailablePersistence(error: unknown): boolean {
  if (error instanceof DatabaseNotConfiguredError) return true;
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
  return ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "53300"].includes(code)
    || code.startsWith("08");
}

export function createClassicGenerateHandler(options: ClassicGenerateHandlerOptions = {}) {
  const env = options.env ?? process.env;
  const production = options.production
    ?? (env.NODE_ENV === "production" || env.VERCEL_ENV === "production");
  const now = options.now ?? (() => new Date());
  const generate = options.generate ?? generateClassicHooks;
  const quota = classicGenerationQuotaFromEnv(env);
  let repository = options.repository;
  let ready: Promise<void> | undefined;

  async function reserveQuota(request: Request): Promise<void> {
    const ipDigest = digestTrustedClientIp(request, env, production);
    repository ??= getAgentRepository();
    ready ??= repository.initialize();
    await ready;
    await repository.transaction(
      (state) => consumeIpQuota(
        state,
        { ipDigest },
        "classic_generation",
        now(),
        { windowMs: quota.windowMs, limit: quota.ipGenerations },
      ),
      { ipDigest },
    );
  }

  return async function handleClassicGenerateRequest(request: Request): Promise<Response> {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) return providerError(new GenerationError("missing_key"));

    let body: GenerateRequest;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as GenerateRequest;
    } catch {
      return json(
        { error: "请求格式错误", message: "请提供有效的 JSON 请求体" },
        400,
      );
    }

    try {
      const normalized = normalizeClassicRequest(body);
      await reserveQuota(request);
      return json(await generate({ request: normalized, apiKey }));
    } catch (error) {
      if (error instanceof ClassicRequestError) {
        return json({ error: error.title, message: error.message }, 400);
      }
      if (error instanceof AgentQuotaError) {
        return json(
          { error: "请求过于频繁", message: "经典生成次数已达上限，请稍后再试" },
          429,
          { "Retry-After": String(error.retryAfterSeconds) },
        );
      }
      if (error instanceof RequestIdentityConfigError || unavailablePersistence(error)) {
        return json(
          { error: "服务暂不可用", message: "生成配额未正确配置，请联系管理员" },
          503,
        );
      }
      if (error instanceof GenerationError) return providerError(error);
      return json(
        { error: "生成失败", message: "生成结果无法处理，请重试" },
        500,
      );
    }
  };
}

export const handleClassicGenerateRequest = createClassicGenerateHandler();
