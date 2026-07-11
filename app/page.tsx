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
import { AppHeader } from "@/components/AppHeader";
import { InputPanel } from "@/components/InputPanel";
import { SkeletonCards } from "@/components/SkeletonCards";
import { HookGrid } from "@/components/HookGrid";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { FavoritesDrawer } from "@/components/FavoritesDrawer";
import {
  ArrowClockwise,
  CheckCircle,
  Copy,
  Heart,
  WarningCircle,
} from "@phosphor-icons/react";

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
      <AppHeader
        favoritesCount={favorites.length}
        historyCount={history.length}
        onOpenFavorites={() => setFavoritesOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 pb-20 md:px-6 md:py-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <InputPanel
          contentType={contentType}
          emotionTone={emotionTone}
          onGenerate={handleGenerate}
          platform={platform}
          setContentType={setContentType}
          setEmotionTone={setEmotionTone}
          setPlatform={setPlatform}
          setTargetAudience={setTargetAudience}
          setTopic={setTopic}
          setWordLimit={setWordLimit}
          status={status}
          targetAudience={targetAudience}
          topic={topic}
          wordLimit={wordLimit}
        />

        <div aria-live="polite" className="min-w-0 space-y-4">
          {status === "idle" && (
            <section className="editorial-panel overflow-hidden">
              <div className="grid min-h-[430px] content-between p-5 sm:p-7">
                <div>
                  <p className="text-xs font-extrabold text-[var(--color-accent)]">你的候选区</p>
                  <h2 className="mt-4 max-w-[14ch] text-3xl font-black leading-[1.05] tracking-[-0.035em] sm:text-4xl">
                    从十个角度里，选出真正能用的一个。
                  </h2>
                  <p className="mt-4 max-w-[58ch] text-sm leading-6 text-[var(--color-graphite)]">
                    生成后，这里会先突出最佳候选，再列出其余版本。模型评分负责解释差异，收藏和采用记录由你决定。
                  </p>
                </div>
                <div className="mt-12 grid gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3">
                  {[
                    { icon: Copy, title: "快速比较", text: "同一主题一次查看 10 种表达。" },
                    { icon: Heart, title: "沉淀收藏", text: "把高价值 Hook 留作复用资产。" },
                    { icon: CheckCircle, title: "记录采用", text: "将真实选择反馈到运营复盘。" },
                  ].map(({ icon: Icon, title, text }) => (
                    <div className="bg-[var(--color-surface)] p-4" key={title}>
                      <Icon aria-hidden="true" className="text-[var(--color-accent)]" size={19} weight="bold" />
                      <h3 className="mt-3 text-sm font-extrabold">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {status === "loading" && <SkeletonCards />}

          {status === "error" && error && (
            <section className="editorial-panel p-5 sm:p-6" role="alert">
              <WarningCircle aria-hidden="true" className="text-[var(--color-danger)]" size={28} weight="fill" />
              <p className="mt-4 text-xs font-extrabold text-[var(--color-danger)]">生成未完成</p>
              <h2 className="mt-2 text-xl font-black">{error.title}</h2>
              <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-sm leading-6 text-[var(--color-graphite)]">
                {error.message}
              </p>
              <button className="button-secondary mt-5" onClick={handleGenerate} type="button">
                <ArrowClockwise aria-hidden="true" size={16} weight="bold" />
                重试生成
              </button>
            </section>
          )}

          {status === "done" && hooks.length > 0 && (
            <HookGrid
              analysis={analysis}
              favoritedIds={favorites}
              hooks={hooks}
              onCopyHook={handleCopyHook}
              onSetSatisfaction={handleSetSatisfaction}
              onToggleAdopted={handleToggleAdopted}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {status === "done" && (
            <section aria-label="本地使用指标" className="editorial-panel grid grid-cols-2 overflow-hidden sm:grid-cols-4">
              {[
                { label: "生成完成率", value: `${stats.completionRate}%` },
                { label: "收藏率", value: `${stats.favoriteRate}%` },
                { label: "采用率", value: `${stats.adoptionRate}%` },
                { label: "平台适配", value: stats.avgPlatformSatisfaction ? `${stats.avgPlatformSatisfaction}/5` : "暂无" },
              ].map((item) => (
                <div className="border-b border-r border-[var(--color-line)] p-3.5 last:border-r-0 sm:border-b-0" key={item.label}>
                  <p className="text-[11px] font-bold text-[var(--color-muted)]">{item.label}</p>
                  <p className="mt-1 text-xl font-black tabular-nums">{item.value}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </main>

      <HistoryDrawer
        history={history}
        loaded={historyLoaded}
        onClearAll={clearAll}
        onClose={() => setHistoryOpen(false)}
        onDelete={deleteHistory}
        onToggleFavorite={toggleHistoryFavorite}
        open={historyOpen}
      />
      <FavoritesDrawer
        favoritedIds={favorites}
        history={history}
        onClose={() => setFavoritesOpen(false)}
        onCopyHook={handleCopyHook}
        onSetSatisfaction={handleSetSatisfaction}
        onToggleAdopted={handleToggleAdopted}
        onToggleFavorite={handleToggleFavorite}
        open={favoritesOpen}
      />
    </div>
  );
}
