export type Platform = "xiaohongshu" | "douyin" | "bilibili" | "youtube" | "x";

export type ContentType = "video" | "image-text" | "product-ad" | "tutorial" | "opinion";

export type EmotionTone =
  | "urgent"
  | "curious"
  | "humorous"
  | "emotional"
  | "authoritative"
  | "rebellious";

export type GenerateStatus = "idle" | "loading" | "done" | "error";

export type PlatformSatisfaction = 1 | 2 | 3 | 4 | 5;

export interface HookScores {
  impact: number;
  platformFit: number;
  actionability: number;
  shareability: number;
}

export interface HookResult {
  id: string;
  text: string;
  style: string;
  reasoning: string;
  clickScore?: number;
  templateVersion?: string;
  promptVariant?: string;
  overallScore?: number;
  scores?: HookScores;
  badcaseTags?: string[];
  adopted?: boolean;
  platformSatisfaction?: PlatformSatisfaction;
  score?: number;
}

export interface GenerateResponse {
  hooks: HookResult[];
  generatedAt: string;
  topic: string;
  platform: Platform;
  contentType: ContentType;
  model?: string;
  templateVersion?: string;
  promptVariant?: string;
  targetAudience?: string;
  emotionTone?: EmotionTone | "";
  wordLimit?: number;
  analysis?: {
    bestStyle: string;
    commonPattern: string;
    improvementTip: string;
  };
}

export interface HistoryItem extends GenerateResponse {
  id: string;
  isFavorited: boolean;
}

export interface GenerateRequest {
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience?: string;
  emotionTone?: EmotionTone | "";
  wordLimit?: number;
  promptVariant?: "baseline" | "candidate";
}
