"use client";

import { Check, Copy, Lightbulb, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { GenerateResponse, HookResult, PlatformSatisfaction } from "@/lib/types";
import { HookCard } from "./HookCard";

interface HookGridProps {
  hooks: HookResult[];
  favoritedIds: string[];
  onToggleFavorite: (id: string) => void;
  onToggleAdopted: (id: string) => void;
  onSetSatisfaction: (id: string, rating: PlatformSatisfaction) => void;
  onCopyHook: (hook: HookResult) => void;
  onRejectBatch: () => void;
  analysis?: GenerateResponse["analysis"] | null;
  coachActions?: {
    onRewrite: (id: string) => void;
    onSelect: (id: string) => void;
    canRewrite: boolean;
    canSelect: boolean;
    canReject: boolean;
    selectedId?: string;
    recommendedIds: string[];
    comparisonExplanations: string[];
    rejecting?: boolean;
  };
}

export function HookGrid({
  hooks,
  favoritedIds,
  onToggleFavorite,
  onToggleAdopted,
  onSetSatisfaction,
  onCopyHook,
  onRejectBatch,
  analysis,
  coachActions,
}: HookGridProps) {
  const [copiedAll, setCopiedAll] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (hooks.length === 0) return null;

  const scoreBestHook = hooks.reduce((best, hook) => {
    const score = hook.overallScore ?? hook.score ?? 0;
    const bestScore = best.overallScore ?? best.score ?? 0;
    return score > bestScore ? hook : best;
  }, hooks[0]);
  const bestHook = coachActions
    ? hooks.find((hook) => hook.id === coachActions.recommendedIds[0]) ?? scoreBestHook
    : scoreBestHook;
  const remainingHooks = hooks.filter((hook) => hook.id !== bestHook.id);
  const bestIndex = hooks.findIndex((hook) => hook.id === bestHook.id);

  const handleCopyAll = async () => {
    const text = hooks.map((hook, index) => `${index + 1}. [${hook.style}] ${hook.text}`).join("\n\n");
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
    setCopiedAll(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedAll(false), 1600);
  };

  return (
    <section aria-labelledby="results-heading" className="editorial-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--color-line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-lg font-black tracking-[-0.025em]" id="results-heading">
            候选 Hook
          </h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {hooks.length} 个候选，{coachActions ? "推荐只用于解释比较，最终选择由你决定。" : "模型分用于排序，最终选择由你决定。"}
          </p>
        </div>
        <button className="button-secondary self-start sm:self-auto" onClick={handleCopyAll} type="button">
          {copiedAll ? <Check aria-hidden="true" size={16} weight="bold" /> : <Copy aria-hidden="true" size={16} weight="bold" />}
          {copiedAll ? "已复制全部" : "复制全部"}
        </button>
      </div>

      <HookCard
        featured
        hook={bestHook}
        isFavorited={favoritedIds.includes(bestHook.id)}
        onCopy={onCopyHook}
        onSetSatisfaction={onSetSatisfaction}
        onToggleAdopted={onToggleAdopted}
        onToggleFavorite={onToggleFavorite}
        styleIndex={bestIndex}
        coachActions={Boolean(coachActions)}
        canRewrite={coachActions?.canRewrite}
        canSelect={coachActions?.canSelect}
        comparisonExplanation={coachActions?.comparisonExplanations[0]}
        onRewrite={coachActions?.onRewrite}
        onSelect={coachActions?.onSelect}
        recommendationRank={coachActions ? 1 : undefined}
        selected={coachActions?.selectedId === bestHook.id}
      />

      {remainingHooks.map((hook) => (
        <HookCard
          hook={hook}
          isFavorited={favoritedIds.includes(hook.id)}
          key={hook.id}
          onCopy={onCopyHook}
          onSetSatisfaction={onSetSatisfaction}
          onToggleAdopted={onToggleAdopted}
          onToggleFavorite={onToggleFavorite}
          styleIndex={hooks.findIndex((item) => item.id === hook.id)}
          coachActions={Boolean(coachActions)}
          canRewrite={coachActions?.canRewrite}
          canSelect={coachActions?.canSelect}
          comparisonExplanation={coachActions ? coachActions.comparisonExplanations[coachActions.recommendedIds.indexOf(hook.id)] : undefined}
          onRewrite={coachActions?.onRewrite}
          onSelect={coachActions?.onSelect}
          recommendationRank={coachActions && coachActions.recommendedIds.includes(hook.id) ? coachActions.recommendedIds.indexOf(hook.id) + 1 : undefined}
          selected={coachActions?.selectedId === hook.id}
        />
      ))}

      <div className="flex flex-col gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs leading-5 text-[var(--color-muted)]">没有一条适合？告诉我们最主要的问题，不会删除本轮结果。</p>
        <button className="button-secondary shrink-0" disabled={coachActions ? !coachActions.canReject || coachActions.rejecting : false} onClick={onRejectBatch} type="button">
          <WarningCircle aria-hidden="true" size={16} weight="bold" />
          这批都不合适
        </button>
      </div>

      {analysis && (analysis.bestStyle || analysis.commonPattern || analysis.improvementTip) && (
        <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-4 sm:p-5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-ink)]">
            <Lightbulb aria-hidden="true" size={16} weight="fill" />
            本轮生成分析
          </div>
          <dl className="mt-3 grid gap-3 text-xs leading-5 text-[var(--color-graphite)] md:grid-cols-3">
            {analysis.bestStyle && (
              <div><dt className="font-bold text-[var(--color-ink)]">最佳风格</dt><dd className="mt-1">{analysis.bestStyle}</dd></div>
            )}
            {analysis.commonPattern && (
              <div><dt className="font-bold text-[var(--color-ink)]">共性规律</dt><dd className="mt-1">{analysis.commonPattern}</dd></div>
            )}
            {analysis.improvementTip && (
              <div><dt className="font-bold text-[var(--color-ink)]">优化建议</dt><dd className="mt-1">{analysis.improvementTip}</dd></div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}
