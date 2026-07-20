"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle,
  Copy,
  Heart,
  Medal,
} from "@phosphor-icons/react";
import type { HookResult, PlatformSatisfaction } from "@/lib/types";

interface HookCardProps {
  hook: HookResult;
  styleIndex: number;
  isFavorited: boolean;
  featured?: boolean;
  onToggleFavorite: (id: string) => void;
  onToggleAdopted: (id: string) => void;
  onSetSatisfaction: (id: string, rating: PlatformSatisfaction) => void;
  onCopy?: (hook: HookResult) => void;
  coachActions?: boolean;
  onRewrite?: (id: string) => void;
  onSelect?: (id: string) => void;
  canRewrite?: boolean;
  canSelect?: boolean;
  selected?: boolean;
  recommendationRank?: number;
  comparisonExplanation?: string;
}

const scoreLabels: Array<{ key: keyof NonNullable<HookResult["scores"]>; label: string }> = [
  { key: "impact", label: "冲击力" },
  { key: "platformFit", label: "平台匹配" },
  { key: "actionability", label: "可操作性" },
  { key: "shareability", label: "传播力" },
];

export function HookCard({
  hook,
  styleIndex,
  isFavorited,
  featured = false,
  onToggleFavorite,
  onToggleAdopted,
  onSetSatisfaction,
  onCopy,
  coachActions = false,
  onRewrite,
  onSelect,
  canRewrite = false,
  canSelect = false,
  selected = false,
  recommendationRank,
  comparisonExplanation,
}: HookCardProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overallScore = hook.overallScore ?? hook.score ?? 7;

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hook.text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = hook.text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    onCopy?.(hook);
  }, [hook, onCopy]);

  return (
    <article
      className={`border-b border-[var(--color-line)] p-4 transition-colors last:border-b-0 sm:p-5 ${
        selected
          ? "border-l-4 border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "bg-[var(--color-surface)]"
      } ${
        featured ? "border-t-2 border-t-[var(--color-accent)]" : selected ? "" : "hover:bg-[#fafaf8]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {featured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-extrabold text-white">
                <Medal aria-hidden="true" size={14} weight="fill" />
                最佳候选
              </span>
            ) : (
              <span className="text-xs font-black tabular-nums text-[var(--color-muted)]">
                {String(styleIndex + 1).padStart(2, "0")}
              </span>
            )}
            <span className="text-xs font-extrabold text-[var(--color-accent)]">{hook.style}</span>
            {coachActions && recommendationRank && (
              <span className="rounded-full border border-[var(--color-accent)] px-2 py-1 text-[11px] font-extrabold text-[var(--color-accent)]">
                推荐 {recommendationRank}
              </span>
            )}
            {hook.adopted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-soft)] px-2 py-1 text-[11px] font-bold text-[var(--color-success)]">
                <CheckCircle aria-hidden="true" size={13} weight="fill" />
                已采用
              </span>
            )}
          </div>
          <p className={`mt-3 max-w-[68ch] font-semibold text-[var(--color-ink)] text-pretty ${featured ? "text-lg leading-8" : "text-[15px] leading-7"}`}>
            {hook.text}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black leading-none tabular-nums tracking-[-0.04em]">
            {overallScore}
          </div>
          <div className="mt-1 text-[10px] font-bold text-[var(--color-muted)]">模型分 / 10</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="button-secondary" onClick={handleCopy} type="button">
          {copied ? <Check aria-hidden="true" size={16} weight="bold" /> : <Copy aria-hidden="true" size={16} weight="bold" />}
          {copied ? "已复制" : "复制"}
        </button>
        {coachActions ? (
          <>
            <button
              className="button-secondary"
              disabled={!canRewrite}
              onClick={() => onRewrite?.(hook.id)}
              type="button"
            >
              改写这条
            </button>
            <button
              aria-pressed={selected}
              className={`button-secondary ${selected ? "border-[var(--color-success)] text-[var(--color-success)]" : ""}`}
              disabled={!canSelect}
              onClick={() => onSelect?.(hook.id)}
              type="button"
            >
              <CheckCircle aria-hidden="true" size={16} weight={selected ? "fill" : "bold"} />
              {selected ? "已加入对比" : "加入对比"}
            </button>
          </>
        ) : (
          <>
            <button
              aria-pressed={isFavorited}
              className={`button-secondary ${isFavorited ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
              onClick={() => onToggleFavorite(hook.id)}
              type="button"
            >
              <Heart aria-hidden="true" size={16} weight={isFavorited ? "fill" : "bold"} />
              {isFavorited ? "已收藏" : "收藏"}
            </button>
            <button
              aria-pressed={Boolean(hook.adopted)}
              className={`button-secondary ${hook.adopted ? "border-[var(--color-success)] text-[var(--color-success)]" : ""}`}
              onClick={() => onToggleAdopted(hook.id)}
              type="button"
            >
              <CheckCircle aria-hidden="true" size={16} weight={hook.adopted ? "fill" : "bold"} />
              {hook.adopted ? "取消采用" : "标记采用"}
            </button>
          </>
        )}
      </div>

      {coachActions && comparisonExplanation && (
        <p className="mt-3 border-l-2 border-[var(--color-accent)] pl-3 text-xs leading-5 text-[var(--color-graphite)]">
          {comparisonExplanation}
        </p>
      )}

      {(hook.scores || hook.reasoning || hook.badcaseTags?.length) && (
        <details className="group mt-4 border-t border-[var(--color-line)] pt-3">
          <summary className="cursor-pointer list-none text-xs font-bold text-[var(--color-graphite)] hover:text-[var(--color-ink)]">
            查看评分与理由
            <span aria-hidden="true" className="ml-1 inline-block transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              {hook.scores && (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {scoreLabels.map(({ key, label }) => (
                    <div className="rounded-[8px] bg-[var(--color-surface-subtle)] px-3 py-2" key={key}>
                      <dt className="text-[11px] font-semibold text-[var(--color-muted)]">{label}</dt>
                      <dd className="mt-1 text-base font-black tabular-nums">{hook.scores?.[key]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {hook.reasoning && (
                <p className="mt-3 max-w-[70ch] text-xs leading-5 text-[var(--color-graphite)]">
                  {hook.reasoning}
                </p>
              )}
              {Boolean(hook.badcaseTags?.length) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {hook.badcaseTags?.map((tag) => (
                    <span className="rounded-full bg-[var(--color-warning-soft)] px-2 py-1 text-[11px] font-bold text-[var(--color-warning)]" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {!coachActions && <fieldset>
              <legend className="text-[11px] font-bold text-[var(--color-muted)]">人工平台适配</legend>
              <div className="mt-2 flex gap-1">
                {([1, 2, 3, 4, 5] as PlatformSatisfaction[]).map((rating) => (
                  <button
                    aria-label={`平台适配满意度 ${rating} 分`}
                    aria-pressed={hook.platformSatisfaction === rating}
                    className={`grid h-8 w-8 place-items-center rounded-[6px] border text-xs font-bold ${
                      hook.platformSatisfaction === rating
                        ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                        : "border-[var(--color-line)] bg-white text-[var(--color-graphite)] hover:border-[var(--color-ink)]"
                    }`}
                    key={rating}
                    onClick={() => onSetSatisfaction(hook.id, rating)}
                    type="button"
                  >
                    {rating}
                  </button>
                ))}
              </div>
            </fieldset>}
          </div>
        </details>
      )}
    </article>
  );
}
