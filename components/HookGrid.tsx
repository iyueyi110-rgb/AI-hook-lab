"use client";

import type { GenerateResponse, HookResult, PlatformSatisfaction } from "@/lib/types";
import { HookCard } from "./HookCard";

interface HookGridProps {
  hooks: HookResult[];
  favoritedIds: string[];
  onToggleFavorite: (id: string) => void;
  onToggleAdopted: (id: string) => void;
  onSetSatisfaction: (id: string, rating: PlatformSatisfaction) => void;
  onCopyHook: (hook: HookResult) => void;
  analysis?: GenerateResponse["analysis"] | null;
}

export function HookGrid({
  hooks,
  favoritedIds,
  onToggleFavorite,
  onToggleAdopted,
  onSetSatisfaction,
  onCopyHook,
  analysis,
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
    <section className="mx-auto mt-10 w-full max-w-6xl overflow-hidden rounded-[18px] border border-neutral-200 bg-white shadow-[0_18px_60px_rgba(17,17,17,0.08)]">
      {analysis && (analysis.bestStyle || analysis.commonPattern || analysis.improvementTip) && (
        <div className="border-b border-neutral-300 p-4 md:p-6">
          <p className="mb-3 text-xs font-bold uppercase text-[#E4002B]">生成分析</p>
          <div className="space-y-2 text-sm leading-6 text-[#111111]">
            {analysis.bestStyle && <p>最佳风格：{analysis.bestStyle}</p>}
            {analysis.commonPattern && <p>共性规律：{analysis.commonPattern}</p>}
            {analysis.improvementTip && <p>优化建议：{analysis.improvementTip}</p>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-neutral-300 px-4 py-4 md:px-6">
        <h2 className="text-lg font-black text-[#111111]">
          生成的 Hook
          <span className="ml-2 text-sm font-bold text-neutral-500">
            ({hooks.length} 个)
          </span>
        </h2>
        <button
          onClick={handleCopyAll}
          className="text-sm font-bold text-[#E4002B] underline decoration-2 underline-offset-4 transition-colors hover:text-[#111111]"
        >
          一键复制全部
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        {hooks.map((hook, index) => (
          <div
            key={hook.id}
            className="border-b border-neutral-300 opacity-0 animate-[fadeIn_0.3s_ease-out_forwards] md:odd:border-r"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <HookCard
              hook={hook}
              styleIndex={index}
              isFavorited={favoritedIds.includes(hook.id)}
              onToggleFavorite={onToggleFavorite}
              onToggleAdopted={onToggleAdopted}
              onSetSatisfaction={onSetSatisfaction}
              onCopy={onCopyHook}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
