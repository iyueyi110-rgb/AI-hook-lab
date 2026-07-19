import {
  buildPromptBundle,
  calculateClickScore,
  DEFAULT_WORD_LIMIT,
  detectBadcases,
  findSensitiveInputHints,
  MAX_IMAGE_DESCRIPTION_LENGTH,
  MAX_TARGET_AUDIENCE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "../promptTemplates.ts";
import type {
  GenerateRequest,
  GenerateResponse,
  HookResult,
  HookScores,
} from "../types.ts";
import {
  generateCandidates,
  GenerationError,
  type GenerationProvider,
} from "./service.ts";

export class ClassicRequestError extends Error {
  readonly title: string;

  constructor(title: string, message: string) {
    super(message);
    this.name = "ClassicRequestError";
    this.title = title;
  }
}

export interface GenerateClassicHooksInput {
  request: GenerateRequest;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  provider?: GenerationProvider;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampScore(value: unknown, fallback = 7): number {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return fallback;
  return Math.max(1, Math.min(10, Math.round(numberValue)));
}

function normalizeScores(raw: Record<string, unknown>): HookScores {
  return {
    impact: clampScore(raw.impact),
    platformFit: clampScore(raw.platformFit),
    actionability: clampScore(raw.actionability),
    shareability: clampScore(raw.shareability),
  };
}

function calculateOverallScore(scores: HookScores): number {
  return clampScore(
    scores.impact * 0.35 +
      scores.platformFit * 0.3 +
      scores.actionability * 0.2 +
      scores.shareability * 0.15
  );
}

function normalizeWordLimit(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return DEFAULT_WORD_LIMIT;
  return Math.max(30, Math.min(150, Math.round(parsed)));
}

export function normalizeClassicRequest(input: GenerateRequest): GenerateRequest {
  const topic = input.topic?.trim() ?? "";
  const targetAudience = input.targetAudience?.trim() ?? "";
  const imageDescription = input.imageDescription?.trim() ?? "";

  if (!topic) throw new ClassicRequestError("主题为空", "请输入一个主题");
  if (topic.length > MAX_TOPIC_LENGTH) {
    throw new ClassicRequestError("主题过长", `主题最多 ${MAX_TOPIC_LENGTH} 个字符，请缩短后重试`);
  }
  if (targetAudience.length > MAX_TARGET_AUDIENCE_LENGTH) {
    throw new ClassicRequestError(
      "目标用户描述过长",
      `目标用户最多 ${MAX_TARGET_AUDIENCE_LENGTH} 个字符，请缩短后重试`
    );
  }
  if (imageDescription.length > MAX_IMAGE_DESCRIPTION_LENGTH) {
    throw new ClassicRequestError(
      "图片描述过长",
      `图片描述最多 ${MAX_IMAGE_DESCRIPTION_LENGTH} 个字符，请清除图片或更换截图`
    );
  }

  const sensitiveHints = findSensitiveInputHints(`${topic}\n${targetAudience}\n${imageDescription}`);
  if (sensitiveHints.length > 0) {
    throw new ClassicRequestError(
      "输入包含疑似个人信息",
      imageDescription
        ? `图片或输入中包含疑似${sensitiveHints.join("、")}，请清除图片、替换截图或改写后重试`
        : `请移除或改写以下信息后再生成：${sensitiveHints.join("、")}`
    );
  }

  return {
    topic,
    platform: input.platform,
    contentType: input.contentType,
    targetAudience: targetAudience || undefined,
    emotionTone: input.emotionTone || undefined,
    wordLimit: normalizeWordLimit(input.wordLimit),
    promptVariant: input.promptVariant === "baseline" ? "baseline" : "candidate",
    imageDescription: imageDescription || undefined,
  };
}

function cleanClassicHooks(
  candidates: unknown[],
  wordLimit: number,
  templateVersion: string,
  promptVariant: string
): HookResult[] {
  return candidates.map((candidate) => {
    const hook = candidate as Record<string, unknown>;
    const text = String(hook.text ?? "").trim();
    if (!text) throw new GenerationError("internal");

    const rawOverall = hook.overallScore ?? hook.score;
    const fallbackOverall = clampScore(rawOverall);
    const scores =
      hook.scores && typeof hook.scores === "object"
        ? normalizeScores(hook.scores as Record<string, unknown>)
        : {
            impact: fallbackOverall,
            platformFit: fallbackOverall,
            actionability: fallbackOverall,
            shareability: fallbackOverall,
          };
    const overallScore =
      rawOverall === undefined ? calculateOverallScore(scores) : clampScore(rawOverall);
    const reasoning = String(hook.reasoning ?? "").trim();

    return {
      id: generateId(),
      text,
      style: String(hook.style ?? "未知风格").trim(),
      reasoning,
      clickScore: calculateClickScore(overallScore),
      templateVersion,
      promptVariant,
      scores,
      overallScore,
      badcaseTags: detectBadcases({ text, reasoning, scores, wordLimit }),
    };
  });
}

export async function generateClassicHooks(
  input: GenerateClassicHooksInput
): Promise<GenerateResponse> {
  const request = normalizeClassicRequest(input.request);
  let promptBundle: ReturnType<typeof buildPromptBundle>;
  try {
    promptBundle = buildPromptBundle(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求参数不支持";
    throw new ClassicRequestError(
      message.includes("平台") ? "平台不支持" : "内容类型不支持",
      message
    );
  }

  const generated = await generateCandidates({
    promptBundle,
    expectedCount: 10,
    provider: input.provider,
    apiKey: input.apiKey,
    fetch: input.fetch,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
  });
  const hooks = cleanClassicHooks(
    generated.candidates,
    request.wordLimit ?? DEFAULT_WORD_LIMIT,
    promptBundle.templateVersion,
    promptBundle.promptVariant
  );
  const analysis =
    generated.payload.analysis && typeof generated.payload.analysis === "object"
      ? {
          bestStyle: String((generated.payload.analysis as Record<string, unknown>).bestStyle ?? ""),
          commonPattern: String(
            (generated.payload.analysis as Record<string, unknown>).commonPattern ?? ""
          ),
          improvementTip: String(
            (generated.payload.analysis as Record<string, unknown>).improvementTip ?? ""
          ),
        }
      : undefined;

  return {
    hooks,
    generatedAt: new Date().toISOString(),
    topic: request.topic,
    platform: request.platform,
    contentType: request.contentType,
    model: promptBundle.model,
    templateVersion: promptBundle.templateVersion,
    promptVariant: promptBundle.promptVariant,
    targetAudience: request.targetAudience,
    emotionTone: request.emotionTone,
    wordLimit: request.wordLimit,
    analysis,
  };
}
