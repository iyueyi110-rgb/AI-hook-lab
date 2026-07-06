"use client";

import { useState, useCallback } from "react";
import type { HookResult, PlatformSatisfaction } from "@/lib/types";
import { STYLE_COLORS } from "@/lib/constants";

interface HookCardProps {
  hook: HookResult;
  styleIndex: number;
  isFavorited: boolean;
  onToggleFavorite: (id: string) => void;
  onToggleAdopted: (id: string) => void;
  onSetSatisfaction: (id: string, rating: PlatformSatisfaction) => void;
  onCopy?: (hook: HookResult) => void;
}

export function HookCard({
  hook,
  styleIndex,
  isFavorited,
  onToggleFavorite,
  onToggleAdopted,
  onSetSatisfaction,
  onCopy,
}: HookCardProps) {
  const [copied, setCopied] = useState(false);
  const colorClass = STYLE_COLORS[styleIndex % STYLE_COLORS.length];
  const overallScore = hook.overallScore ?? hook.score ?? 7;
  const finalBadcaseTags = hook.badcaseTags ?? [];

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hook.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = hook.text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    onCopy?.(hook);
  }, [hook, onCopy]);

  const scoreColor =
    overallScore >= 8
      ? "text-emerald-600"
      : overallScore >= 6
      ? "text-amber-600"
      : "text-rose-600";

  return (
    <div className="group rounded-2xl border border-gray-100 bg-gray-50/60 p-5 transition-all hover:shadow-md hover:border-gray-200">
      {/* Top row: style badge + copy */}
      <div className="flex items-center justify-between mb-3">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
        >
          {hook.style}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity md:opacity-100">
          <button
            onClick={handleCopy}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              copied
                ? "bg-emerald-50 text-emerald-600"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            }`}
            aria-label={copied ? "已复制" : "复制"}
          >
            {copied ? "✓ 已复制" : "复制"}
          </button>
          <button
            onClick={() => onToggleFavorite(hook.id)}
            className={`rounded-lg px-2 py-1.5 text-sm transition-all ${
              isFavorited
                ? "text-rose-500"
                : "text-gray-400 hover:text-rose-400"
            }`}
            aria-label={isFavorited ? "取消收藏" : "收藏"}
          >
            {isFavorited ? "♥" : "♡"}
          </button>
        </div>
      </div>

      {/* Hook text */}
      <p className="text-sm text-gray-800 leading-relaxed mb-3">
        {hook.text}
      </p>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">点击欲望</span>
        <span className={`text-xs font-semibold ${scoreColor}`}>
          {overallScore}/10
        </span>
      </div>

      {hook.scores ? (
        <div className="space-y-1.5 mb-3">
          {[
            { key: "impact", label: "冲击力", value: hook.scores.impact },
            { key: "platformFit", label: "平台匹配", value: hook.scores.platformFit },
            { key: "actionability", label: "可操作性", value: hook.scores.actionability },
            { key: "shareability", label: "传播力", value: hook.scores.shareability },
          ].map((dim) => (
            <div key={dim.key} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-14 shrink-0">{dim.label}</span>
              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    dim.value >= 8
                      ? "bg-emerald-500"
                      : dim.value >= 6
                      ? "bg-amber-500"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${(dim.value / 10) * 100}%` }}
                />
              </div>
              <span
                className={`text-xs font-semibold w-7 text-right ${
                  dim.value >= 8
                    ? "text-emerald-600"
                    : dim.value >= 6
                    ? "text-amber-600"
                    : "text-rose-600"
                }`}
              >
                {dim.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                overallScore >= 8
                  ? "bg-emerald-500"
                  : overallScore >= 6
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
              style={{ width: `${(overallScore / 10) * 100}%` }}
            />
          </div>
        </div>
      )}

      {finalBadcaseTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {finalBadcaseTags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Reasoning */}
      <p className="text-xs text-gray-400 leading-relaxed mb-4">{hook.reasoning}</p>

      <div className="border-t border-gray-100 pt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">创作复用</span>
          <button
            type="button"
            onClick={() => onToggleAdopted(hook.id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              hook.adopted
                ? "bg-violet-600 text-white"
                : "bg-white text-gray-500 border border-gray-200 hover:border-violet-200 hover:text-violet-600"
            }`}
          >
            {hook.adopted ? "已采用" : "标记采用"}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">平台适配</span>
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5] as PlatformSatisfaction[]).map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => onSetSatisfaction(hook.id, rating)}
                className={`h-6 w-6 rounded-md text-xs font-semibold transition-all ${
                  hook.platformSatisfaction === rating
                    ? "bg-violet-600 text-white"
                    : "bg-white text-gray-400 border border-gray-200 hover:text-violet-600 hover:border-violet-200"
                }`}
                aria-label={`平台适配满意度 ${rating} 分`}
              >
                {rating}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
