"use client";

import { useState, useCallback } from "react";
import type { HistoryItem, GenerateResponse, HookResult } from "@/lib/types";
import { mergeHistoryItem } from "@/lib/history";

const STORAGE_KEY = "ai-hook-lab-history";

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [loaded] = useState(() => typeof window !== "undefined");

  const addToHistory = useCallback((item: GenerateResponse) => {
    setHistory((prev) => {
      const updated = mergeHistoryItem(prev, item);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const deleteHistory = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setHistory([]);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, isFavorited: !item.isFavorited } : item
      );
      saveHistory(updated);
      return updated;
    });
  }, []);

  const updateHook = useCallback((hookId: string, updater: (hook: HookResult) => HookResult) => {
    setHistory((prev) => {
      const updated = prev.map((item) => ({
        ...item,
        hooks: item.hooks.map((hook) => (hook.id === hookId ? updater(hook) : hook)),
      }));
      saveHistory(updated);
      return updated;
    });
  }, []);

  return {
    history,
    loaded,
    addToHistory,
    deleteHistory,
    clearAll,
    toggleFavorite,
    updateHook,
  };
}
