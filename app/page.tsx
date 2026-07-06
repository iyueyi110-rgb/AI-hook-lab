"use client";

import React from "react";
import type {
  Platform,
  ContentType,
  EmotionTone,
  GenerateStatus,
  HookResult,
  GenerateResponse,
  PlatformSatisfaction,
} from "@/lib/types";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { useAnalytics } from "@/hooks/useAnalytics";
import { Header } from "@/components/Header";
import { InputPanel } from "@/components/InputPanel";
import { SkeletonCards } from "@/components/SkeletonCards";
import { HookGrid } from "@/components/HookGrid";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { FavoritesDrawer } from "@/components/FavoritesDrawer";

export default function Home() {
  const [topic, setTopic] = React.useState("");
  const [platform, setPlatform] = React.useState<Platform>("xiaohongshu");
  const [contentType, setContentType] = React.useState<ContentType>("video");
  const [status, setStatus] = React.useState<GenerateStatus>("idle");
  const [hooks, setHooks] = React.useState<HookResult[]>([]);
  const [targetAudience, setTargetAudience] = React.useState("");
  const [emotionTone, setEmotionTone] = React.useState<EmotionTone | "">("");
  const [wordLimit, setWordLimit] = React.useState(80);
  const [analysis, setAnalysis] = React.useState<GenerateResponse["analysis"] | null>(null);
  const [error, setError] = React.useState<{ title: string; message: string } | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [favoritesOpen, setFavoritesOpen] = React.useState(false);

  const { history, loaded: historyLoaded, addToHistory, deleteHistory, clearAll, toggleFavorite: toggleHistoryFavorite, updateHook } = useHistory();
  const { favorites, toggleFavorite } = useFavorites();
  const { track, trackSatisfaction, stats } = useAnalytics();

  const handleGenerate = React.useCallback(async () => {
    if (!topic.trim() || status === "loading") return;

    setStatus("loading");
    setError(null);
    setHooks([]);
    setAnalysis(null);
    const startedAt = Date.now();
    track("generation_start", { topic: topic.trim(), platform, contentType });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          platform,
          contentType,
          targetAudience: targetAudience.trim() || undefined,
          emotionTone: emotionTone || undefined,
          wordLimit,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError({ title: data.error ?? "生成失败", message: data.message ?? "未知错误" });
        setStatus("error");
        track("generation_error", { error: data.error ?? "生成失败" });
        return;
      }

      const response = data as GenerateResponse;
      setHooks(response.hooks);
      setAnalysis(response.analysis ?? null);
      setStatus("done");
      addToHistory(response);
      const avgScore =
        response.hooks.length > 0
          ? response.hooks.reduce((sum, hook) => sum + (hook.overallScore ?? hook.score ?? 0), 0) /
            response.hooks.length
          : 0;
      track("generation_complete", {
        platform,
        contentType,
        hookCount: response.hooks.length,
        avgScore,
        durationMs: Date.now() - startedAt,
        badcaseTags: response.hooks.flatMap((hook) => hook.badcaseTags ?? []),
      });
    } catch {
      setError({
        title: "网络错误",
        message: "无法连接到服务器，请检查网络后重试",
      });
      setStatus("error");
      track("generation_error", { error: "网络错误" });
    }
  }, [
    topic,
    platform,
    contentType,
    targetAudience,
    emotionTone,
    wordLimit,
    status,
    addToHistory,
    track,
  ]);

  const handleToggleFavorite = React.useCallback(
    (id: string) => {
      const willFavorite = !favorites.includes(id);
      toggleFavorite(id);
      toggleHistoryFavorite(id);
      track(willFavorite ? "hook_favorited" : "hook_unfavorited", { hookId: id });
    },
    [favorites, toggleFavorite, toggleHistoryFavorite, track]
  );

  const handleToggleAdopted = React.useCallback(
    (id: string) => {
      const current = hooks.find((hook) => hook.id === id);
      const adopted = !current?.adopted;
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, adopted } : hook;
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, adopted }));
      track(adopted ? "hook_adopted" : "hook_unadopted", { hookId: id });
    },
    [hooks, track, updateHook]
  );

  const handleSetSatisfaction = React.useCallback(
    (id: string, rating: PlatformSatisfaction) => {
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, platformSatisfaction: rating } : hook;
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, platformSatisfaction: rating }));
      trackSatisfaction(id, rating);
    },
    [trackSatisfaction, updateHook]
  );

  const handleCopyHook = React.useCallback(
    (hook: HookResult) => {
      track("hook_copied", { hookId: hook.id, style: hook.style });
    },
    [track]
  );

  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="pb-20">
        <InputPanel
          topic={topic}
          setTopic={setTopic}
          platform={platform}
          setPlatform={setPlatform}
          contentType={contentType}
          setContentType={setContentType}
          targetAudience={targetAudience}
          setTargetAudience={setTargetAudience}
          emotionTone={emotionTone}
          setEmotionTone={setEmotionTone}
          wordLimit={wordLimit}
          setWordLimit={setWordLimit}
          status={status}
          onGenerate={handleGenerate}
        />

        {/* Loading */}
        {status === "loading" && <SkeletonCards />}

        {/* Error */}
        {status === "error" && error && (
          <div className="w-full max-w-2xl mx-auto mt-10 px-4 md:px-0">
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0">⚠️</span>
                <div>
                  <h3 className="text-sm font-semibold text-rose-800">
                    {error.title}
                  </h3>
                  <p className="mt-1 text-sm text-rose-600 whitespace-pre-wrap">
                    {error.message}
                  </p>
                  <button
                    onClick={handleGenerate}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white border border-rose-200 px-3.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                  >
                    重试
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {status === "done" && hooks.length > 0 && (
          <HookGrid
            hooks={hooks}
            favoritedIds={favorites}
            onToggleFavorite={handleToggleFavorite}
            onToggleAdopted={handleToggleAdopted}
            onSetSatisfaction={handleSetSatisfaction}
            onCopyHook={handleCopyHook}
            analysis={analysis}
          />
        )}

        {/* Bottom action bar */}
        {status === "done" && (
          <div className="w-full max-w-4xl mx-auto mt-8 px-4 md:px-0">
            <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "生成完成率", value: `${stats.completionRate}%` },
                { label: "收藏率", value: `${stats.favoriteRate}%` },
                { label: "采用率", value: `${stats.adoptionRate}%` },
                {
                  label: "平台适配满意度",
                  value: stats.avgPlatformSatisfaction
                    ? `${stats.avgPlatformSatisfaction}/5`
                    : "暂无",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              历史记录
              {history.length > 0 && (
                <span className="text-xs text-gray-400 ml-0.5">({history.length})</span>
              )}
            </button>
            <button
              onClick={() => setFavoritesOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <span className="text-sm">💜</span>
              收藏夹
              {favorites.length > 0 && (
                <span className="text-xs text-gray-400 ml-0.5">({favorites.length})</span>
              )}
            </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {status === "idle" && (
          <div className="w-full max-w-2xl mx-auto mt-16 px-4 md:px-0 text-center">
            <p className="text-5xl mb-4">🎣</p>
            <p className="text-sm text-gray-400">
              输入主题，选择平台和内容类型，AI 为你生成 10 个爆款 Hook
            </p>
          </div>
        )}
      </main>

      {/* Drawers */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        loaded={historyLoaded}
        onDelete={deleteHistory}
        onToggleFavorite={toggleHistoryFavorite}
        onClearAll={clearAll}
      />
      <FavoritesDrawer
        open={favoritesOpen}
        onClose={() => setFavoritesOpen(false)}
        history={history}
        favoritedIds={favorites}
        onToggleFavorite={handleToggleFavorite}
        onToggleAdopted={handleToggleAdopted}
        onSetSatisfaction={handleSetSatisfaction}
        onCopyHook={handleCopyHook}
      />
    </div>
  );
}
