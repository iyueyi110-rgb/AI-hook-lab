"use client";

import { useState } from "react";
import type { HistoryItem } from "@/lib/types";
import { PLATFORM_CONFIG, CONTENT_TYPE_CONFIG } from "@/lib/constants";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  history: HistoryItem[];
  loaded: boolean;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryDrawer({
  open,
  onClose,
  history,
  loaded,
  onDelete,
  onToggleFavorite,
  onClearAll,
}: HistoryDrawerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  if (!open) return null;

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
              历史记录
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {loaded ? `${history.length} 条记录` : "加载中..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("确定清空全部历史记录？")) onClearAll();
                }}
                className="text-xs text-gray-400 hover:text-rose-500 transition-colors px-2 py-1"
              >
                清空
              </button>
            )}
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
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {!loaded ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              加载中...
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center px-4">
              <p className="text-4xl mb-3">📭</p>
              <p className="text-sm text-gray-400">还没有生成记录</p>
              <p className="text-xs text-gray-300 mt-1">
                生成 Hook 后会自动保存到这里
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {history.map((item) => (
                <div key={item.id} className="px-5 py-3.5">
                  {/* Summary row */}
                  <div
                    className="flex items-start justify-between cursor-pointer"
                    onClick={() =>
                      setExpandedId(
                        expandedId === item.id ? null : item.id
                      )
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {item.topic}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-3">
                        <span>
                          {PLATFORM_CONFIG[item.platform]?.emoji}{" "}
                          {PLATFORM_CONFIG[item.platform]?.label}
                        </span>
                        <span>
                          {CONTENT_TYPE_CONFIG[item.contentType]?.label}
                        </span>
                        <span>
                          {new Date(item.generatedAt).toLocaleDateString(
                            "zh-CN",
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <span
                        className={`text-sm ${
                          item.isFavorited
                            ? "text-rose-500"
                            : "text-gray-300"
                        }`}
                      >
                        {item.isFavorited ? "♥" : "♡"}
                      </span>
                      <span className="text-gray-300 text-xs">
                        {expandedId === item.id ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expandedId === item.id && (
                    <div className="mt-3 space-y-2">
                      {item.hooks.map((hook) => {
                        const overallScore = hook.overallScore ?? hook.score ?? "?";
                        return (
                          <div
                            key={hook.id}
                            className="rounded-lg bg-gray-50 p-3 text-sm"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-violet-600">
                                {hook.style}
                              </span>
                              <span className="text-xs text-gray-400">
                                评分 {overallScore}/10
                              </span>
                            </div>
                            <p className="text-gray-700 leading-relaxed">
                              {hook.text}
                            </p>
                            {(hook.badcaseTags?.length || hook.adopted || hook.platformSatisfaction) && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {hook.adopted && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-100">
                                    已采用
                                  </span>
                                )}
                                {hook.platformSatisfaction && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                    平台适配 {hook.platformSatisfaction}/5
                                  </span>
                                )}
                                {hook.badcaseTags?.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          onClick={() => onToggleFavorite(item.id)}
                          className={`text-xs font-medium cursor-pointer ${
                            item.isFavorited
                              ? "text-rose-500"
                              : "text-gray-400 hover:text-rose-400"
                          }`}
                        >
                          {item.isFavorited
                            ? "♥ 已收藏"
                            : "♡ 收藏"}
                        </button>
                        <button
                          onClick={async () => {
                            setDeleting(item.id);
                            // small delay for animation
                            await new Promise((r) => setTimeout(r, 150));
                            onDelete(item.id);
                            setDeleting(null);
                          }}
                          className={`text-xs text-gray-400 hover:text-rose-500 transition-colors cursor-pointer ${
                            deleting === item.id ? "opacity-50" : ""
                          }`}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
