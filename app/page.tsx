"use client";

import React from "react";
import type { Platform, ContentType, GenerateStatus, HookResult, GenerateResponse } from "@/lib/types";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
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
  const [error, setError] = React.useState<{ title: string; message: string } | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [favoritesOpen, setFavoritesOpen] = React.useState(false);

  const { history, loaded: historyLoaded, addToHistory, deleteHistory, clearAll, toggleFavorite: toggleHistoryFavorite } = useHistory();
  const { favorites, toggleFavorite } = useFavorites();

  const handleGenerate = React.useCallback(async () => {
    if (!topic.trim() || status === "loading") return;

    setStatus("loading");
    setError(null);
    setHooks([]);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), platform, contentType }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError({ title: data.error ?? "生成失败", message: data.message ?? "未知错误" });
        setStatus("error");
        return;
      }

      const response = data as GenerateResponse;
      setHooks(response.hooks);
      setStatus("done");
      addToHistory(response);
    } catch {
      setError({
        title: "网络错误",
        message: "无法连接到服务器，请检查网络后重试",
      });
      setStatus("error");
    }
  }, [topic, platform, contentType, status, addToHistory]);

  const handleToggleFavorite = React.useCallback(
    (id: string) => {
      toggleFavorite(id);
      toggleHistoryFavorite(id);
    },
    [toggleFavorite, toggleHistoryFavorite]
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
          />
        )}

        {/* Bottom action bar */}
        {status === "done" && (
          <div className="w-full max-w-4xl mx-auto mt-8 px-4 md:px-0 flex items-center justify-center gap-3">
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
      />
    </div>
  );
}
