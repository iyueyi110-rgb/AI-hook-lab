import { PLATFORM_STYLES } from "../constants.ts";
import type { ContentType, EmotionTone, Platform } from "../types.ts";
import { AGENT_BUDGET } from "./budget.ts";
import type { CreativeBrief, WordLimitBand } from "./types.ts";

export const MEMORY_WORD_LIMIT_BANDS: WordLimitBand[] = ["30-50", "60-80", "90-110", "120-150"];

type BriefInput = Partial<CreativeBrief> & {
  topic?: string;
  platform?: Platform;
  contentType?: ContentType;
  emotionTone?: EmotionTone;
};

export type BriefNormalization =
  | { kind: "complete"; brief: CreativeBrief }
  | {
      kind: "needs_clarification" | "requires_form_completion";
      missing: Array<"topic" | "platform" | "contentType">;
      invalidFields?: string[];
    };

const PLATFORMS: Platform[] = ["xiaohongshu", "douyin", "bilibili", "youtube", "x"];
const CONTENT_TYPES: ContentType[] = ["video", "image-text", "product-ad", "tutorial", "opinion"];
const EMOTION_TONES: EmotionTone[] = ["urgent", "curious", "humorous", "emotional", "authoritative", "rebellious"];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function normalizeBrief(input: BriefInput | unknown, clarificationAttempts = 0): BriefNormalization {
  const value = asRecord(input);
  const invalidFields: string[] = [];
  const platform = value.platform;
  const contentType = value.contentType;
  const emotionTone = value.emotionTone;
  const validPlatform = typeof platform === "string" && PLATFORMS.includes(platform as Platform);
  const validContentType = typeof contentType === "string" && CONTENT_TYPES.includes(contentType as ContentType);
  const validTone = emotionTone === undefined || (typeof emotionTone === "string" && EMOTION_TONES.includes(emotionTone as EmotionTone));
  if (platform !== undefined && !validPlatform) invalidFields.push("platform");
  if (contentType !== undefined && !validContentType) invalidFields.push("contentType");
  if (!validTone) invalidFields.push("emotionTone");
  const preferredStyle = value.preferredStyle;
  const validPreferredStyle = preferredStyle === undefined || (
    validPlatform && typeof preferredStyle === "string" && PLATFORM_STYLES[platform as Platform].includes(preferredStyle)
  );
  if (!validPreferredStyle) invalidFields.push("preferredStyle");
  const missing = (["topic", "platform", "contentType"] as const).filter((key) => {
    if (key === "platform") return !validPlatform;
    if (key === "contentType") return !validContentType;
    return !nonEmptyString(value.topic);
  });
  if (missing.length || invalidFields.length) {
    return {
      kind: clarificationAttempts >= AGENT_BUDGET.clarificationQuestions ? "requires_form_completion" : "needs_clarification",
      missing,
      ...(invalidFields.length ? { invalidFields } : {}),
    };
  }

  return {
    kind: "complete",
    brief: {
      topic: (value.topic as string).trim(),
      platform: platform as Platform,
      contentType: contentType as ContentType,
      targetAudience: nonEmptyString(value.targetAudience) ? value.targetAudience.trim() : "general audience",
      emotionTone: (emotionTone as EmotionTone | undefined) ?? "curious",
      wordLimitBand: MEMORY_WORD_LIMIT_BANDS.includes(value.wordLimitBand as WordLimitBand)
        ? value.wordLimitBand as WordLimitBand
        : MEMORY_WORD_LIMIT_BANDS[1],
      preferredStyle: preferredStyle as string | undefined,
      avoidBadcaseTags: Array.isArray(value.avoidBadcaseTags)
        ? [...new Set(value.avoidBadcaseTags.filter((tag): tag is string => typeof tag === "string"))]
        : [],
      imageDescription: nonEmptyString(value.imageDescription) ? value.imageDescription.trim() : undefined,
    },
  };
}
