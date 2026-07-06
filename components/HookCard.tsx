"use client";

import { useState, useCallback } from "react";
import type { HookResult, PlatformSatisfaction } from "@/lib/types";

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
  const overallScore = hook.overallScore ?? hook.score ?? 7;
  const clickScore = hook.clickScore ?? Math.round(overallScore * 10);
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
    clickScore >= 80
      ? "text-[#111111]"
      : clickScore >= 60
      ? "text-[#E4002B]"
      : "text-[#E4002B]";

  return (
    <div className="group flex h-full flex-col bg-white p-5 transition-colors hover:bg-neutral-50">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <span className="block text-xs font-bold uppercase text-[#E4002B]">
            {String(styleIndex + 1).padStart(2, "0")}
          </span>
          <span className="mt-1 block text-sm font-black text-[#111111]">
            {hook.style}
          </span>
          <span className="mt-2 inline-flex border border-neutral-200 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-neutral-500">
            AI 生成
          </span>
        </div>
        <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
          <button
            onClick={handleCopy}
            className={`border px-2.5 py-1.5 text-xs font-bold transition-colors ${
              copied
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-neutral-300 bg-white text-[#111111] hover:border-[#E4002B] hover:text-[#E4002B]"
            }`}
            aria-label={copied ? "已复制" : "复制"}
          >
            {copied ? "已复制" : "复制"}
          </button>
          <button
            onClick={() => onToggleFavorite(hook.id)}
            className={`grid h-8 w-8 place-items-center border transition-colors ${
              isFavorited
                ? "border-[#E4002B] bg-[#E4002B] text-white"
                : "border-neutral-300 bg-white text-[#111111] hover:border-[#E4002B] hover:text-[#E4002B]"
            }`}
            aria-label={isFavorited ? "取消收藏" : "收藏"}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill={isFavorited ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.8 4.6c-1.6-1.5-4.1-1.5-5.7 0L12 7.7 8.9 4.6c-1.6-1.5-4.1-1.5-5.7 0-1.6 1.6-1.6 4.1 0 5.7L12 19l8.8-8.7c1.6-1.6 1.6-4.1 0-5.7Z" />
            </svg>
          </button>
        </div>
      </div>

      <p className="mb-4 text-base font-semibold leading-7 text-[#111111]">
        {hook.text}
      </p>

      <div className="mb-2 mt-auto flex items-center justify-between">
        <span className="text-xs font-bold text-neutral-500">点击欲望</span>
        <span className={`text-xs font-semibold ${scoreColor}`}>
          {clickScore}/100
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
              <span className="w-14 shrink-0 text-xs text-neutral-500">{dim.label}</span>
              <div className="h-1 flex-1 overflow-hidden bg-neutral-200">
                <div
                  className={`h-full transition-all duration-500 ${
                    dim.value >= 8
                      ? "bg-[#111111]"
                      : dim.value >= 6
                      ? "bg-[#E4002B]"
                      : "bg-[#E4002B]"
                  }`}
                  style={{ width: `${(dim.value / 10) * 100}%` }}
                />
              </div>
              <span
                className={`text-xs font-semibold w-7 text-right ${
                  dim.value >= 8
                    ? "text-[#111111]"
                    : dim.value >= 6
                    ? "text-[#E4002B]"
                    : "text-[#E4002B]"
                }`}
              >
                {dim.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <div className="h-1.5 flex-1 overflow-hidden bg-neutral-200">
            <div
              className={`h-full transition-all duration-500 ${
                overallScore >= 8
                  ? "bg-[#111111]"
                  : overallScore >= 6
                  ? "bg-[#E4002B]"
                  : "bg-[#E4002B]"
              }`}
              style={{ width: `${(overallScore / 10) * 100}%` }}
            />
          </div>
        </div>
      )}

      {(hook.templateVersion || hook.promptVariant) && (
        <div className="mb-3 flex flex-wrap gap-1">
          {hook.templateVersion && (
            <span className="border border-neutral-200 px-1.5 py-0.5 text-xs font-bold text-neutral-500">
              Prompt {hook.templateVersion}
            </span>
          )}
          {hook.promptVariant && (
            <span className="border border-neutral-200 px-1.5 py-0.5 text-xs font-bold text-neutral-500">
              {hook.promptVariant}
            </span>
          )}
        </div>
      )}

      {finalBadcaseTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {finalBadcaseTags.map((tag) => (
            <span
              key={tag}
              className="border border-[#E4002B] bg-white px-1.5 py-0.5 text-xs font-bold text-[#E4002B]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Reasoning */}
      <p className="mb-4 text-xs leading-5 text-neutral-500">{hook.reasoning}</p>

      <div className="flex flex-col gap-3 border-t border-neutral-300 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-neutral-500">创作复用</span>
          <button
            type="button"
            onClick={() => onToggleAdopted(hook.id)}
            className={`border px-2.5 py-1.5 text-xs font-bold transition-colors ${
              hook.adopted
                ? "border-[#111111] bg-[#111111] text-white"
                : "border-neutral-300 bg-white text-[#111111] hover:border-[#E4002B] hover:text-[#E4002B]"
            }`}
          >
            {hook.adopted ? "已采用" : "标记采用"}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-neutral-500">平台适配</span>
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5] as PlatformSatisfaction[]).map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => onSetSatisfaction(hook.id, rating)}
                className={`h-7 w-7 border text-xs font-bold transition-colors ${
                  hook.platformSatisfaction === rating
                    ? "border-[#E4002B] bg-[#E4002B] text-white"
                    : "border-neutral-300 bg-white text-[#111111] hover:border-[#E4002B] hover:text-[#E4002B]"
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
