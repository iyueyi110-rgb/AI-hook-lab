"use client";

import { useCallback, useMemo, useState } from "react";
import type { PlatformSatisfaction } from "@/lib/types";

type EventType =
  | "generation_start"
  | "generation_complete"
  | "generation_error"
  | "hook_copied"
  | "hook_favorited"
  | "hook_unfavorited"
  | "hook_adopted"
  | "hook_unadopted"
  | "platform_satisfaction";

interface AnalyticsEvent {
  type: EventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

interface AnalyticsStats {
  totalGenerations: number;
  totalHooksGenerated: number;
  favoritedCount: number;
  copiedCount: number;
  adoptedCount: number;
  avgScore: number;
  avgClickScore: number;
  completionRate: number;
  favoriteRate: number;
  adoptionRate: number;
  avgPlatformSatisfaction: number;
}

const STORAGE_KEY = "ai-hook-lab-analytics";
const MAX_EVENTS = 1000;

function loadEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEvents(events: AnalyticsEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // localStorage can be unavailable or full.
  }
}

function sendServerEvent(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  fetch("/api/dashboard/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {
    // Dashboard persistence should never block the creator workflow.
  });
}

export function useAnalytics() {
  const [events, setEvents] = useState<AnalyticsEvent[]>(loadEvents);

  const track = useCallback((type: EventType, payload?: Record<string, unknown>) => {
    const event = { type, timestamp: new Date().toISOString(), payload };
    setEvents((prev) => {
      const next = [...prev, event];
      saveEvents(next);
      return next.slice(-MAX_EVENTS);
    });
    sendServerEvent(event);
  }, []);

  const stats = useMemo((): AnalyticsStats => {
    const starts = events.filter((event) => event.type === "generation_start").length;
    const completes = events.filter((event) => event.type === "generation_complete");
    const favs = events.filter((event) => event.type === "hook_favorited").length;
    const unfavs = events.filter((event) => event.type === "hook_unfavorited").length;
    const adopted = events.filter((event) => event.type === "hook_adopted").length;
    const unadopted = events.filter((event) => event.type === "hook_unadopted").length;
    const copies = events.filter((event) => event.type === "hook_copied").length;
    const satisfactionEvents = events.filter((event) => event.type === "platform_satisfaction");

    const totalHooks = completes.reduce(
      (sum, event) => sum + (Number(event.payload?.hookCount) || 0),
      0
    );
    const scoreSum = completes.reduce(
      (sum, event) => sum + (Number(event.payload?.avgScore) || 0),
      0
    );
    const clickScoreSum = completes.reduce(
      (sum, event) =>
        sum +
        (Number(event.payload?.avgClickScore) ||
          (Number(event.payload?.avgScore) || 0) * 10),
      0
    );
    const satisfactionSum = satisfactionEvents.reduce(
      (sum, event) => sum + (Number(event.payload?.rating) || 0),
      0
    );

    return {
      totalGenerations: starts,
      totalHooksGenerated: totalHooks,
      favoritedCount: Math.max(0, favs - unfavs),
      copiedCount: copies,
      adoptedCount: Math.max(0, adopted - unadopted),
      avgScore: completes.length > 0 ? Math.round((scoreSum / completes.length) * 10) / 10 : 0,
      avgClickScore:
        completes.length > 0 ? Math.round((clickScoreSum / completes.length) * 10) / 10 : 0,
      completionRate: starts > 0 ? Math.round((completes.length / starts) * 100) : 0,
      favoriteRate: totalHooks > 0 ? Math.round((Math.max(0, favs - unfavs) / totalHooks) * 100) : 0,
      adoptionRate:
        totalHooks > 0 ? Math.round((Math.max(0, adopted - unadopted) / totalHooks) * 100) : 0,
      avgPlatformSatisfaction:
        satisfactionEvents.length > 0
          ? Math.round((satisfactionSum / satisfactionEvents.length) * 10) / 10
          : 0,
    };
  }, [events]);

  const trackSatisfaction = useCallback(
    (hookId: string, rating: PlatformSatisfaction, payload?: Record<string, unknown>) => {
      track("platform_satisfaction", { ...payload, hookId, rating });
    },
    [track]
  );

  return { track, trackSatisfaction, stats };
}
