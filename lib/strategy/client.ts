import type { ContentType, Platform } from "../types.ts";
import type { ActiveStrategyView } from "./service.ts";

export async function fetchActiveStrategies(
  platform: Platform,
  contentType: ContentType,
  signal?: AbortSignal,
): Promise<ActiveStrategyView[]> {
  const params = new URLSearchParams({ platform, contentType });
  const response = await fetch(`/api/strategies/active?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) return [];
  const body = await response.json().catch(() => null) as {
    strategies?: ActiveStrategyView[];
    message?: string;
  } | null;
  if (!response.ok) throw new Error(body?.message ?? "无法读取策略卡");
  return Array.isArray(body?.strategies) ? body.strategies.slice(0, 5) : [];
}

export function createStrategyPresentationId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `strategy-presentation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
