import { PLATFORM_STYLES } from "../constants.ts";
import { findSensitiveInputHints } from "../promptTemplates.ts";
import type { EmotionTone, Platform } from "../types.ts";
import { MEMORY_WORD_LIMIT_BANDS } from "./brief.ts";
import { assertExpectedRevision } from "./machine.ts";
import type { AgentRun, CreativeBrief, Memory, MemoryEntry, MemoryKey } from "./types.ts";

const PLATFORMS: Platform[] = ["xiaohongshu", "douyin", "bilibili", "youtube", "x"];
const TONES: EmotionTone[] = ["urgent", "curious", "humorous", "emotional", "authoritative", "rebellious"];
const STYLES = Object.values(PLATFORM_STYLES).flat();
export const KNOWN_BADCASE_TAGS = ["too_generic", "platform_mismatch", "weak_reasoning", "too_long", "too_short", "clickbait_risk"] as const;

function isAllowedValue(key: MemoryKey, value: string): boolean {
  if (!value.trim() || findSensitiveInputHints(value).length) return false;
  if (key === "default_platform") return PLATFORMS.includes(value as Platform);
  if (key === "preferred_tone") return TONES.includes(value as EmotionTone);
  if (key === "word_limit_band") return MEMORY_WORD_LIMIT_BANDS.includes(value as (typeof MEMORY_WORD_LIMIT_BANDS)[number]);
  if (key === "avoid_badcase_tag") return (KNOWN_BADCASE_TAGS as readonly string[]).includes(value);
  return STYLES.includes(value);
}

function conflicts(entries: MemoryEntry[], key: MemoryKey, value: string): boolean {
  const opposite = key === "preferred_style" ? "avoided_style" : key === "avoided_style" ? "preferred_style" : undefined;
  return Boolean(opposite && entries.some((entry) => entry.key === opposite && entry.value === value));
}

function updateMemory(memory: Memory, update: { key: MemoryKey; value: string }): { memory: Memory; accepted: boolean } {
  if (!isAllowedValue(update.key, update.value) || conflicts(memory.entries, update.key, update.value)) {
    return { memory, accepted: false };
  }
  const existing = memory.entries.find((entry) => entry.key === update.key && entry.value === update.value);
  if (existing) {
    return {
      accepted: true,
      memory: { entries: memory.entries.map((entry) => entry === existing ? { ...entry, confidence: Math.min(0.9, entry.confidence + 0.1) } : entry) },
    };
  }
  return { accepted: true, memory: { entries: [...memory.entries, { ...update, confidence: 0.6 }] } };
}

export function recordMemory(
  run: AgentRun,
  expectedRevision: number,
  update: { key: MemoryKey; value: string }
): { run: AgentRun; accepted: boolean } {
  assertExpectedRevision(run, expectedRevision);
  const result = updateMemory(run.memory, update);
  return {
    accepted: result.accepted,
    run: result.accepted ? { ...run, memory: result.memory, revision: run.revision + 1 } : run,
  };
}

const BRIEF_FIELD: Partial<Record<MemoryKey, keyof CreativeBrief>> = {
  default_platform: "platform",
  preferred_style: "preferredStyle",
  preferred_tone: "emotionTone",
  word_limit_band: "wordLimitBand",
};

export function resolveMemoryPreference(memory: Memory, key: MemoryKey, brief: Partial<CreativeBrief>): string | undefined {
  const field = BRIEF_FIELD[key];
  const fromBrief = field ? brief[field] : undefined;
  if (typeof fromBrief === "string" && fromBrief.trim()) return fromBrief;
  return memory.entries.find((entry) => entry.key === key)?.value;
}
