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
  | { kind: "needs_clarification" | "requires_form_completion"; missing: Array<"topic" | "platform" | "contentType"> };

export function normalizeBrief(input: BriefInput, clarificationAttempts = 0): BriefNormalization {
  const missing = (["topic", "platform", "contentType"] as const).filter((key) => !input[key]?.trim?.());
  if (missing.length) {
    return {
      kind: clarificationAttempts >= AGENT_BUDGET.clarificationQuestions ? "requires_form_completion" : "needs_clarification",
      missing,
    };
  }

  const platform = input.platform!;
  const preferredStyle = input.preferredStyle && PLATFORM_STYLES[platform].includes(input.preferredStyle)
    ? input.preferredStyle
    : undefined;
  return {
    kind: "complete",
    brief: {
      topic: input.topic!.trim(),
      platform,
      contentType: input.contentType!,
      targetAudience: input.targetAudience?.trim() || "general audience",
      emotionTone: input.emotionTone ?? "curious",
      wordLimitBand: input.wordLimitBand ?? MEMORY_WORD_LIMIT_BANDS[1],
      preferredStyle,
      avoidBadcaseTags: [...new Set(input.avoidBadcaseTags ?? [])],
      imageDescription: input.imageDescription?.trim() || undefined,
    },
  };
}
