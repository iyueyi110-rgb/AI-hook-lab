import type { Candidate, CreativeBrief, WordLimitBand } from "./agent/types.ts";
import type {
  ContentType,
  EmotionTone,
  HookResult,
  HookScores,
  Platform,
} from "./types.ts";

export interface WorkbenchBriefInput {
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience: string;
  emotionTone: EmotionTone | "";
  wordLimit: number;
  imageDescription?: string;
}

function clampScore(value: unknown, fallback = 7): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function normalizeScores(scores: HookScores | undefined, fallback: number): HookScores {
  return {
    impact: clampScore(scores?.impact, fallback),
    platformFit: clampScore(scores?.platformFit, fallback),
    actionability: clampScore(scores?.actionability, fallback),
    shareability: clampScore(scores?.shareability, fallback),
  };
}

export function wordLimitToBand(value: number): WordLimitBand {
  if (value <= 50) return "30-50";
  if (value <= 80) return "60-80";
  if (value <= 110) return "90-110";
  return "120-150";
}

export function buildWorkbenchBrief(input: WorkbenchBriefInput): Partial<CreativeBrief> {
  const targetAudience = input.targetAudience.trim();
  const imageDescription = input.imageDescription?.trim();
  return {
    topic: input.topic.trim(),
    platform: input.platform,
    contentType: input.contentType,
    ...(targetAudience ? { targetAudience } : {}),
    ...(input.emotionTone ? { emotionTone: input.emotionTone } : {}),
    wordLimitBand: wordLimitToBand(input.wordLimit),
    ...(imageDescription ? { imageDescription } : {}),
  };
}

export function hooksToSeedCandidates(hooks: HookResult[]): Candidate[] {
  return hooks.map((hook, index) => {
    const overallScore = clampScore(hook.overallScore ?? hook.score);
    return {
      id: hook.id || `candidate-${index + 1}`,
      text: hook.text.trim(),
      style: hook.style.trim(),
      reasoning: hook.reasoning.trim(),
      overallScore,
      scores: normalizeScores(hook.scores, overallScore),
      badcaseTags: [...new Set(hook.badcaseTags ?? [])],
    };
  });
}

export function candidatesToHooks(candidates: Candidate[]): HookResult[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    text: candidate.text,
    style: candidate.style,
    reasoning: candidate.reasoning,
    score: candidate.overallScore,
    overallScore: candidate.overallScore,
    scores: { ...candidate.scores },
    badcaseTags: [...candidate.badcaseTags],
  }));
}
