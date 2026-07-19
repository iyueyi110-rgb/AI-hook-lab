import type { OpsToolCall } from "./ops-types";
import type { OpsToolDefinition } from "./ops-tools";

export type OpsProviderMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpsProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface OpsProviderResponse {
  content: string | null;
  toolCalls: OpsToolCall[];
  usage: OpsProviderUsage;
  assistantMessage: Extract<OpsProviderMessage, { role: "assistant" }>;
}

export interface OpsProvider {
  complete(input: { messages: OpsProviderMessage[]; tools: OpsToolDefinition[]; signal?: AbortSignal }): Promise<OpsProviderResponse>;
}

export type OpsProviderErrorCode = "missing_key" | "auth" | "rate_limit" | "timeout" | "empty_response" | "upstream";

export class OpsProviderError extends Error {
  readonly code: OpsProviderErrorCode;
  readonly status?: number;
  constructor(code: OpsProviderErrorCode, status?: number) {
    super(code);
    this.name = "OpsProviderError";
    this.code = code;
    this.status = status;
  }
}

const DEEPSEEK_CHAT_COMPLETIONS = "https://api.deepseek.com/v1/chat/completions";

export function createDeepSeekOpsProvider(options: {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  model?: string;
  timeoutMs?: number;
}): OpsProvider {
  const apiKey = options.apiKey?.trim();
  const fetcher = options.fetch ?? globalThis.fetch;
  const model = options.model ?? "deepseek-chat";
  return {
    async complete(input) {
      if (!apiKey) throw new OpsProviderError("missing_key");
      if (input.signal?.aborted) throw new OpsProviderError("timeout");
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, options.timeoutMs ?? 30_000);
      try {
        const toolFields = input.tools.length ? {
          tools: input.tools.map(({ type, function: fn }) => ({ type, function: fn })),
          tool_choice: "auto",
        } : {
          response_format: { type: "json_object" as const },
        };
        const response = await fetcher(DEEPSEEK_CHAT_COMPLETIONS, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: input.messages,
            ...toolFields,
            temperature: 0.1,
            max_tokens: 2_048,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) throw new OpsProviderError("auth", response.status);
          if (response.status === 429) throw new OpsProviderError("rate_limit", response.status);
          throw new OpsProviderError("upstream", response.status);
        }
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
        };
        const message = body.choices?.[0]?.message;
        if (!message) throw new OpsProviderError("empty_response");
        const toolCalls = (message.tool_calls ?? []).map((call, index) => ({
          id: typeof call.id === "string" && call.id ? call.id : `tool-call-${index}`,
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "{}",
        }));
        const assistantMessage: Extract<OpsProviderMessage, { role: "assistant" }> = {
          role: "assistant",
          content: message.content ?? null,
          ...(toolCalls.length ? { tool_calls: toolCalls.map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } })) } : {}),
        };
        return {
          content: message.content ?? null,
          toolCalls,
          assistantMessage,
          usage: {
            inputTokens: body.usage?.prompt_tokens ?? 0,
            outputTokens: body.usage?.completion_tokens ?? 0,
            cachedInputTokens: body.usage?.prompt_cache_hit_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof OpsProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new OpsProviderError("timeout");
        throw new OpsProviderError("upstream");
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
      }
    },
  };
}
