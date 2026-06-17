"use client";

import type { HistoryItem } from "@/lib/types";
import { PLATFORM_CONFIG } from "@/lib/constants";
import { STYLE_COLORS } from "@/lib/constants";

interface FavoritesDrawerProps {
  open: boolean;
  onClose: () => void;
  history: HistoryItem[];
  favoritedIds: string[];
  onToggleFavorite: (id: string) => void;
}

export function FavoritesDrawer({
  open,
  onClose,
  history,
  favoritedIds,
  onToggleFavorite,
}: FavoritesDrawerProps) {
  if (!open) return null;

  const favoritedHooks = history
    .flatMap((item) =>
      item.hooks.map((hook) => ({
        ...hook,
        topic: item.topic,
        platform: item.platform,
        generatedAt: item.generatedAt,
        historyId: item.id,
      }))
    )
    .filter((hook) => favoritedIds.includes(hook.id));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed z-50 bg-white shadow-xl flex flex-col
          top-0 right-0 h-full w-full max-w-md
          max-md:bottom-0 max-md:top-auto max-md:h-[85vh] max-md:max-w-full max-md:rounded-t-2xl
          md:border-l border-gray-100
          animate-[slideInRight_0.25s_ease-out]
          max-md:animate-[slideInUp_0.25s_ease-out]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              收藏夹
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {favoritedHooks.length} 个收藏
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-50"
            aria-label="关闭"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {favoritedHooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center px-4">
              <p className="text-4xl mb-3">💜</p>
              <p className="text-sm text-gray-400">还没有收藏的 Hook</p>
              <p className="text-xs text-gray-300 mt-1">
                点击结果卡片上的 ♡ 来收藏
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {favoritedHooks.map((hook) => {
                const colorClass =
                  STYLE_COLORS[
                    [...new Set(favoritedHooks.map((h) => h.style))]
                      .indexOf(hook.style) % STYLE_COLORS.length
                  ] ?? STYLE_COLORS[0];

                const handleCopy = async (text: string) => {
                  try {
                    await navigator.clipboard.writeText(text);
                  } catch {
                    const textarea = document.createElement("textarea");
                    textarea.value = text;
                    textarea.style.position = "fixed";
                    textarea.style.opacity = "0";
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand("copy");
                    document.body.removeChild(textarea);
                  }
                };

                return (
                  <div key={hook.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
                        >
                          {hook.style}
                        </span>
                        <span className="text-xs text-gray-400">
                          {PLATFORM_CONFIG[hook.platform]?.emoji}{" "}
                          {PLATFORM_CONFIG[hook.platform]?.label}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-gray-500">
                        {hook.score}/10
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed mb-2">
                      {hook.text}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300">
                        主题：{hook.topic}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopy(hook.text)}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                        >
                          复制
                        </button>
                        <button
                          onClick={() => onToggleFavorite(hook.id)}
                          className="text-sm text-rose-500 cursor-pointer"
                        >
                          ♥
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
