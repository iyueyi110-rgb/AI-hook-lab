export type Platform = "xiaohongshu" | "douyin" | "bilibili" | "youtube" | "x";

export type ContentType = "video" | "image-text" | "product-ad" | "tutorial" | "opinion";

export type GenerateStatus = "idle" | "loading" | "done" | "error";

export interface HookResult {
  id: string;
  text: string;
  style: string;
  score: number;
  reasoning: string;
}

export interface GenerateResponse {
  hooks: HookResult[];
  generatedAt: string;
  topic: string;
  platform: Platform;
  contentType: ContentType;
}

export interface HistoryItem extends GenerateResponse {
  id: string;
  isFavorited: boolean;
}

export interface GenerateRequest {
  topic: string;
  platform: Platform;
  contentType: ContentType;
}
