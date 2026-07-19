import type { GenerateResponse, HistoryItem } from "./types.ts";

export const MAX_HISTORY_ITEMS = 50;

function historyId(response: GenerateResponse): string {
  if (response.taskId) return `agent-run:${response.taskId}`;
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function mergeHistoryItem(history: HistoryItem[], response: GenerateResponse): HistoryItem[] {
  if (response.taskId && history.some((item) => item.taskId === response.taskId)) return history;
  const historyItem: HistoryItem = {
    ...response,
    id: historyId(response),
    isFavorited: false,
  };
  return [historyItem, ...history].slice(0, MAX_HISTORY_ITEMS);
}
