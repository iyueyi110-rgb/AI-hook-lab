"use client";

import React from "react";

const STORAGE_KEY = "ai-hook-lab-favorites";

function loadFavorites(): string[] {
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

function saveFavorites(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = React.useState<string[]>(loadFavorites);

  const toggleFavorite = React.useCallback((hookId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(hookId)
        ? prev.filter((id) => id !== hookId)
        : [...prev, hookId];
      saveFavorites(next);
      return next;
    });
  }, []);

  return { favorites, toggleFavorite };
}
