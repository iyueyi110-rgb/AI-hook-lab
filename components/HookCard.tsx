"use client";

import { useState, useCallback } from "react";
import type { HookResult } from "@/lib/types";
import { STYLE_COLORS } from "@/lib/constants";

interface HookCardProps {
  hook: HookResult;
  styleIndex: number;
  isFavorited: boolean;
  onToggleFavorite: (id: string) => void;
}

export function HookCard({
  hook,
  styleIndex,
  isFavorited,
  onToggleFavorite,
}: HookCardProps) {
  const [copied, setCopied] = useState(false);
  const colorClass = STYLE_COLORS[styleIndex % STYLE_COLORS.length];

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
  }, [hook.text]);

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

      {/* Score bar */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-400 whitespace-nowrap">
          点击欲望
        </span>
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              hook.score >= 8
                ? "bg-emerald-500"
                : hook.score >= 6
                ? "bg-amber-500"
                : "bg-rose-500"
            }`}
            style={{ width: `${(hook.score / 10) * 100}%` }}
          />
        </div>
        <span
          className={`text-xs font-semibold ${
            hook.score >= 8
              ? "text-emerald-600"
              : hook.score >= 6
              ? "text-amber-600"
              : "text-rose-600"
          }`}
        >
          {hook.score}/10
        </span>
      </div>

      {/* Reasoning */}
      <p className="text-xs text-gray-400 leading-relaxed">{hook.reasoning}</p>
    </div>
  );
}
