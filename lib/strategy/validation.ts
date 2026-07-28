import { createHash } from "node:crypto";

import type { ContentType, Platform } from "../types.ts";
import type { StrategyContent, StrategyScopePair } from "./types.ts";

const PLATFORMS = new Set<Platform>(["xiaohongshu", "douyin", "bilibili", "youtube", "x"]);
const CONTENT_TYPES = new Set<ContentType>(["video", "image-text", "product-ad", "tutorial", "opinion"]);
const CONTROL_OR_ZERO_WIDTH = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const HTML = /<\/?[a-z][^>]*>/iu;
const MARKDOWN_LINK_OR_FENCE = /```|!?\[[^\]]*\]\([^)]*\)/u;
const SCHEMA_FRAGMENT = /["']?(?:type|properties|required|items)["']?\s*:\s*["'{[]/iu;
const SECRET = /(?:\b(?:api[_\s-]?key|secret|password|access[_\s-]?token)\b\s*[:=]\s*\S+)|\bsk-[a-z0-9_-]{8,}|\beyJ[a-zA-Z0-9_-]{12,}\./iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/u;
const INJECTION = /(?:忽略|覆盖|绕过|无视).{0,24}(?:系统|开发者|提示词|指令|规则)|(?:调用|执行).{0,16}(?:工具|函数|命令)|(?:修改|强制).{0,16}(?:输出|JSON|Schema|格式)|\b(?:ignore|override|bypass)\b.{0,32}\b(?:system|developer|prompt|instruction|rule)s?\b|\b(?:call|invoke|execute)\b.{0,24}\b(?:tool|function|command)s?\b/iu;

export type StrategyValidationCode =
  | "invalid_shape"
  | "title_length"
  | "scope_pairs"
  | "audience_length"
  | "guidance_count"
  | "guidance_length"
  | "hypothesis_length"
  | "unsafe_control_character"
  | "unsafe_markup"
  | "unsafe_schema"
  | "unsafe_secret"
  | "personal_data"
  | "unsafe_instruction";

export class StrategyValidationError extends Error {
  readonly code: StrategyValidationCode;
  constructor(code: StrategyValidationCode) {
    super(code);
    this.name = "StrategyValidationError";
    this.code = code;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown, code: StrategyValidationCode, min: number, max: number): string {
  if (typeof value !== "string") throw new StrategyValidationError(code);
  if (CONTROL_OR_ZERO_WIDTH.test(value)) throw new StrategyValidationError("unsafe_control_character");
  const normalized = value.normalize("NFC").trim();
  if (normalized.length < min || normalized.length > max) throw new StrategyValidationError(code);
  if (HTML.test(normalized) || MARKDOWN_LINK_OR_FENCE.test(normalized)) throw new StrategyValidationError("unsafe_markup");
  if (SCHEMA_FRAGMENT.test(normalized)) throw new StrategyValidationError("unsafe_schema");
  if (SECRET.test(normalized)) throw new StrategyValidationError("unsafe_secret");
  if (EMAIL.test(normalized) || PHONE.test(normalized)) throw new StrategyValidationError("personal_data");
  if (INJECTION.test(normalized)) throw new StrategyValidationError("unsafe_instruction");
  return normalized;
}

function scopePairs(value: unknown): StrategyScopePair[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new StrategyValidationError("scope_pairs");
  }
  const pairs = value.map((raw) => {
    if (!record(raw) || Object.keys(raw).some((key) => key !== "platform" && key !== "contentType")) {
      throw new StrategyValidationError("scope_pairs");
    }
    if (!PLATFORMS.has(raw.platform as Platform) || !CONTENT_TYPES.has(raw.contentType as ContentType)) {
      throw new StrategyValidationError("scope_pairs");
    }
    return { platform: raw.platform as Platform, contentType: raw.contentType as ContentType };
  });
  if (new Set(pairs.map((pair) => `${pair.platform}:${pair.contentType}`)).size !== pairs.length) {
    throw new StrategyValidationError("scope_pairs");
  }
  return pairs;
}

function guidanceItems(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new StrategyValidationError("guidance_count");
  return value.map((item) => normalizeText(item, "guidance_length", 1, 160));
}

export function validateStrategyContent(value: unknown): StrategyContent {
  if (!record(value)) throw new StrategyValidationError("invalid_shape");
  if (Object.keys(value).some((key) => !["title", "scopePairs", "audienceLabel", "guidance", "hypothesis"].includes(key))) {
    throw new StrategyValidationError("invalid_shape");
  }
  const title = normalizeText(value.title, "title_length", 1, 80);
  const pairs = scopePairs(value.scopePairs);
  const audienceLabel = value.audienceLabel === undefined || value.audienceLabel === ""
    ? undefined
    : normalizeText(value.audienceLabel, "audience_length", 1, 60);
  if (!record(value.guidance)) throw new StrategyValidationError("invalid_shape");
  if (Object.keys(value.guidance).some((key) => key !== "do" && key !== "avoid")) {
    throw new StrategyValidationError("invalid_shape");
  }
  const doItems = guidanceItems(value.guidance.do, 2);
  const avoidItems = guidanceItems(value.guidance.avoid, 1);
  if (doItems.length + avoidItems.length < 1 || doItems.length + avoidItems.length > 3) {
    throw new StrategyValidationError("guidance_count");
  }
  const hypothesis = normalizeText(value.hypothesis, "hypothesis_length", 1, 300);
  return {
    title,
    scopePairs: pairs,
    ...(audienceLabel ? { audienceLabel } : {}),
    guidance: { do: doItems, avoid: avoidItems },
    hypothesis,
  };
}

export function strategyContentFromStored(
  value: StrategyContent,
): StrategyContent {
  return validateStrategyContent({
    title: value.title,
    scopePairs: value.scopePairs,
    ...(value.audienceLabel ? { audienceLabel: value.audienceLabel } : {}),
    guidance: value.guidance,
    hypothesis: value.hypothesis,
  });
}

function canonicalContent(content: StrategyContent): string {
  return JSON.stringify({
    title: content.title,
    scopePairs: content.scopePairs.map((pair) => ({ platform: pair.platform, contentType: pair.contentType })),
    audienceLabel: content.audienceLabel ?? null,
    guidance: { do: content.guidance.do, avoid: content.guidance.avoid },
    hypothesis: content.hypothesis,
  });
}

export function computeStrategyContentHash(content: StrategyContent): string {
  return createHash("sha256").update(canonicalContent(validateStrategyContent(content))).digest("hex");
}

export function strategyPromptData(content: StrategyContent): string {
  const validated = validateStrategyContent(content);
  return JSON.stringify({ do: validated.guidance.do, avoid: validated.guidance.avoid });
}
