export type GenerationErrorCode =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "empty_response"
  | "invalid_json"
  | "invalid_count"
  | "upstream"
  | "internal";

export interface GenerationPromptBundle {
  model: string;
  templateVersion: string;
  promptVariant: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderGenerationInput {
  promptBundle: GenerationPromptBundle;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerationProvider {
  generate(input: ProviderGenerationInput): Promise<unknown>;
}

export interface GenerateCandidatesInput extends ProviderGenerationInput {
  expectedCount: number;
  candidateField?: string;
  maxRetries?: number;
  provider?: GenerationProvider;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface GenerateCandidatesResult {
  payload: Record<string, unknown>;
  candidates: unknown[];
  attempts: number;
}

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;
  readonly attempts?: number;
  readonly status?: number;

  constructor(
    code: GenerationErrorCode,
    options: { attempts?: number; status?: number } = {}
  ) {
    super(code);
    this.name = "GenerationError";
    this.code = code;
    this.attempts = options.attempts;
    this.status = options.status;
  }
}

const DEEPSEEK_CHAT_COMPLETIONS = "https://api.deepseek.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TEMPERATURE = 0.95;
const DEFAULT_MAX_TOKENS = 8192;

export function createDeepSeekProvider(options: {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): GenerationProvider {
  const apiKey = options.apiKey?.trim();
  const fetcher = options.fetch ?? globalThis.fetch;

  return {
    async generate(input) {
      if (!apiKey) throw new GenerationError("missing_key");
      if (!fetcher) throw new GenerationError("internal");

      const controller = input.signal ? undefined : new AbortController();
      const signal = input.signal ?? controller?.signal;
      const timeout = controller
        ? setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        : undefined;

      try {
        const response = await fetcher(DEEPSEEK_CHAT_COMPLETIONS, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: input.promptBundle.model,
            messages: [
              { role: "system", content: input.promptBundle.systemPrompt },
              { role: "user", content: input.promptBundle.userPrompt },
            ],
            temperature: input.temperature ?? DEFAULT_TEMPERATURE,
            max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
            response_format: { type: "json_object" },
          }),
          signal,
        });

        if (!response.ok) {
          if (response.status === 401) throw new GenerationError("auth");
          if (response.status === 429) throw new GenerationError("rate_limit");
          throw new GenerationError("upstream", { status: response.status });
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new GenerationError("upstream");
        }
        const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
          ?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          throw new GenerationError("empty_response");
        }
        return content;
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new GenerationError("timeout");
        }
        throw new GenerationError("upstream");
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const fencedJson = value.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)?.[1] ?? value;
    try {
      return parsePayload(JSON.parse(fencedJson.trim()));
    } catch {
      throw new GenerationError("invalid_json");
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError("invalid_json");
  }

  return value as Record<string, unknown>;
}

function retryLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(2, Math.floor(value ?? 2)));
}

function isRetryable(error: unknown): error is GenerationError {
  return (
    error instanceof GenerationError &&
    (error.code === "invalid_json" || error.code === "invalid_count")
  );
}

function withAttempts(error: GenerationError, attempts: number): GenerationError {
  return new GenerationError(error.code, { attempts, status: error.status });
}

function createDeadline(
  controller: AbortController,
  deadlineAt: number,
  now: () => number,
): {
  promise: Promise<never>;
  clear: () => void;
} {
  let timeout: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GenerationError("timeout"));
    }, Math.max(0, deadlineAt - now()));
  });

  return {
    promise,
    clear: () => clearTimeout(timeout),
  };
}

export async function generateCandidates(
  input: GenerateCandidatesInput
): Promise<GenerateCandidatesResult> {
  if (!Number.isInteger(input.expectedCount) || input.expectedCount < 1) {
    throw new GenerationError("internal");
  }

  const provider =
    input.provider ??
    createDeepSeekProvider({
      apiKey: input.apiKey,
      fetch: input.fetch,
      timeoutMs: input.timeoutMs,
    });
  const field = input.candidateField ?? "hooks";
  const attemptsAllowed = retryLimit(input.maxRetries) + 1;
  const now = input.now ?? (() => performance.now());
  const deadlineAt = now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    const controller = new AbortController();
    const deadline = createDeadline(controller, deadlineAt, now);
    try {
      const generated = await Promise.race([
        Promise.resolve().then(() =>
          provider.generate({
            promptBundle: input.promptBundle,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
            signal: controller.signal,
          })
        ),
        deadline.promise,
      ]);
      const payload = parsePayload(generated);
      const candidates = payload[field];

      if (!Array.isArray(candidates) || candidates.length !== input.expectedCount) {
        throw new GenerationError("invalid_count");
      }

      return { payload, candidates, attempts: attempt };
    } catch (error) {
      const generationError =
        error instanceof GenerationError
            ? error
            : controller.signal.aborted
              ? new GenerationError("timeout")
            : new GenerationError("internal");
      if (isRetryable(generationError) && attempt < attemptsAllowed) continue;
      throw withAttempts(generationError, attempt);
    } finally {
      deadline.clear();
    }
  }

  throw new GenerationError("internal");
}
