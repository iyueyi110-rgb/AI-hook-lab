"use client";

import type { HookResult } from "@/lib/types";
import { HookCard } from "./HookCard";

interface HookGridProps {
  hooks: HookResult[];
  favoritedIds: string[];
  onToggleFavorite: (id: string) => void;
}

export function HookGrid({
  hooks,
  favoritedIds,
  onToggleFavorite,
}: HookGridProps) {
  if (hooks.length === 0) return null;

  const handleCopyAll = async () => {
    const text = hooks
      .map((h, i) => `${i + 1}. [${h.style}] ${h.text}`)
      .join("\n\n");
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
    <section className="w-full max-w-4xl mx-auto mt-10 px-4 md:px-0">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">
          生成的 Hook
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({hooks.length} 个)
          </span>
        </h2>
        <button
          onClick={handleCopyAll}
          className="text-sm text-violet-600 hover:text-violet-700 font-medium transition-colors"
        >
          一键复制全部
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hooks.map((hook, index) => (
          <div
            key={hook.id}
            className="opacity-0 animate-[fadeIn_0.3s_ease-out_forwards]"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <HookCard
              hook={hook}
              styleIndex={index}
              isFavorited={favoritedIds.includes(hook.id)}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
