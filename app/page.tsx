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
import {
  DEFAULT_PROMPT_VARIANT,
  GENERATION_MODEL,
  PROMPT_TEMPLATE_VERSION,
} from "@/lib/promptTemplates";

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

  const findHookContext = React.useCallback(
    (id: string) => {
      const currentHook = hooks.find((hook) => hook.id === id);
      if (currentHook) {
        return { hook: currentHook, platform, contentType };
      }

      for (const item of history) {
        const historyHook = item.hooks.find((hook) => hook.id === id);
        if (historyHook) {
          return {
            hook: historyHook,
            platform: item.platform,
            contentType: item.contentType,
          };
        }
      }

      return null;
    },
    [contentType, history, hooks, platform]
  );

  const handleGenerate = React.useCallback(async () => {
    if (!topic.trim() || status === "loading") return;

    setStatus("loading");
    setError(null);
    setHooks([]);
    setAnalysis(null);
    const startedAt = Date.now();
    track("generation_start", {
      topic: topic.trim(),
      platform,
      contentType,
      model: GENERATION_MODEL,
      templateVersion: PROMPT_TEMPLATE_VERSION,
      promptVariant: DEFAULT_PROMPT_VARIANT,
    });

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
        track("generation_error", {
          error: data.error ?? "生成失败",
          platform,
          contentType,
          model: GENERATION_MODEL,
          templateVersion: PROMPT_TEMPLATE_VERSION,
          promptVariant: DEFAULT_PROMPT_VARIANT,
        });
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
      const avgClickScore =
        response.hooks.length > 0
          ? response.hooks.reduce((sum, hook) => sum + (hook.clickScore ?? 0), 0) /
            response.hooks.length
          : 0;
      track("generation_complete", {
        platform,
        contentType,
        model: response.model,
        templateVersion: response.templateVersion,
        promptVariant: response.promptVariant,
        hookCount: response.hooks.length,
        avgScore,
        avgClickScore,
        durationMs: Date.now() - startedAt,
        badcaseTags: response.hooks.flatMap((hook) => hook.badcaseTags ?? []),
      });
    } catch {
      setError({
        title: "网络错误",
        message: "无法连接到服务器，请检查网络后重试",
      });
      setStatus("error");
      track("generation_error", {
        error: "网络错误",
        platform,
        contentType,
        model: GENERATION_MODEL,
        templateVersion: PROMPT_TEMPLATE_VERSION,
        promptVariant: DEFAULT_PROMPT_VARIANT,
      });
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
      const context = findHookContext(id);
      toggleFavorite(id);
      toggleHistoryFavorite(id);
      track(willFavorite ? "hook_favorited" : "hook_unfavorited", {
        hookId: id,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
    },
    [favorites, findHookContext, toggleFavorite, toggleHistoryFavorite, track]
  );

  const handleToggleAdopted = React.useCallback(
    (id: string) => {
      const context = findHookContext(id);
      const current = context?.hook;
      const adopted = !current?.adopted;
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, adopted } : hook;
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, adopted }));
      track(adopted ? "hook_adopted" : "hook_unadopted", {
        hookId: id,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
    },
    [findHookContext, track, updateHook]
  );

  const handleSetSatisfaction = React.useCallback(
    (id: string, rating: PlatformSatisfaction) => {
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, platformSatisfaction: rating } : hook;
      const context = findHookContext(id);
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, platformSatisfaction: rating }));
      trackSatisfaction(id, rating, {
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
    },
    [findHookContext, trackSatisfaction, updateHook]
  );

  const handleCopyHook = React.useCallback(
    (hook: HookResult) => {
      const context = findHookContext(hook.id);
      track("hook_copied", {
        hookId: hook.id,
        style: hook.style,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: hook.templateVersion,
        promptVariant: hook.promptVariant,
        clickScore: hook.clickScore,
      });
    },
    [findHookContext, track]
  );

  return (
    <div className="min-h-screen">
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
          <div className="mx-auto mt-10 w-full max-w-6xl rounded-[18px] border border-neutral-200 bg-white shadow-[0_18px_60px_rgba(17,17,17,0.08)]">
            <div className="border-b border-[#E4002B] p-4 md:p-6">
              <p className="mb-2 text-xs font-bold uppercase text-[#E4002B]">
                生成失败
              </p>
              <h3 className="text-lg font-black text-[#111111]">
                {error.title}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                {error.message}
              </p>
              <button
                onClick={handleGenerate}
                className="mt-4 border border-[#111111] bg-white px-4 py-2 text-xs font-bold text-[#111111] transition-colors hover:border-[#E4002B] hover:text-[#E4002B]"
              >
                重试
              </button>
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
          <div className="mx-auto mt-8 w-full max-w-6xl overflow-hidden rounded-[18px] border border-neutral-200 bg-white shadow-[0_18px_60px_rgba(17,17,17,0.08)]">
            <div className="grid grid-cols-2 md:grid-cols-5">
              {[
                { label: "生成完成率", value: `${stats.completionRate}%` },
                { label: "收藏率", value: `${stats.favoriteRate}%` },
                { label: "采用率", value: `${stats.adoptionRate}%` },
                {
                  label: "平均点击欲望",
                  value: stats.avgClickScore ? `${stats.avgClickScore}/100` : "暂无",
                },
                {
                  label: "平台适配满意度",
                  value: stats.avgPlatformSatisfaction
                    ? `${stats.avgPlatformSatisfaction}/5`
                    : "暂无",
                },
              ].map((item) => (
                <div key={item.label} className="border-b border-neutral-300 p-4 md:border-r md:last:border-r-0">
                  <p className="text-xs font-bold text-neutral-500">{item.label}</p>
                  <p className="mt-1 text-2xl font-black text-[#111111]">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-px bg-neutral-300">
            <button
              onClick={() => setHistoryOpen(true)}
              className="inline-flex min-h-12 items-center gap-2 bg-white px-4 py-2 text-sm font-bold text-[#111111] transition-colors hover:text-[#E4002B]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              历史记录
              {history.length > 0 && (
                <span className="ml-0.5 text-xs text-neutral-500">({history.length})</span>
              )}
            </button>
            <button
              onClick={() => setFavoritesOpen(true)}
              className="inline-flex min-h-12 items-center gap-2 bg-white px-4 py-2 text-sm font-bold text-[#111111] transition-colors hover:text-[#E4002B]"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.8 4.6c-1.6-1.5-4.1-1.5-5.7 0L12 7.7 8.9 4.6c-1.6-1.5-4.1-1.5-5.7 0-1.6 1.6-1.6 4.1 0 5.7L12 19l8.8-8.7c1.6-1.6 1.6-4.1 0-5.7Z" />
              </svg>
              收藏夹
              {favorites.length > 0 && (
                <span className="ml-0.5 text-xs text-neutral-500">({favorites.length})</span>
              )}
            </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {status === "idle" && (
          <div className="mx-auto mt-8 flex w-full max-w-6xl items-center justify-between overflow-hidden rounded-[18px] border border-neutral-200 bg-white px-5 py-6 shadow-[0_18px_60px_rgba(17,17,17,0.08)] md:px-8">
            <div>
            <p className="text-lg font-black text-[#111111]">
              等待输入
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
              输入主题后即可生成。平台、内容类型和高级选项会共同影响 Hook 的语气、结构和长度。
            </p>
            </div>
            <div className="hidden rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-black text-[#E4002B] md:block">
              Hook 1 · Hook 2 · Hook 3
            </div>
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
