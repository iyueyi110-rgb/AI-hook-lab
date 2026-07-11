"use client";

import {
  CheckCircle,
  Copy,
  Heart,
} from "@phosphor-icons/react";
import type { HistoryItem, HookResult, PlatformSatisfaction } from "@/lib/types";
import { PLATFORM_CONFIG } from "@/lib/constants";
import { DrawerShell } from "./DrawerShell";

interface FavoritesDrawerProps {
  open: boolean;
  onClose: () => void;
  history: HistoryItem[];
  favoritedIds: string[];
  onToggleFavorite: (id: string) => void;
  onToggleAdopted: (id: string) => void;
  onSetSatisfaction: (id: string, rating: PlatformSatisfaction) => void;
  onCopyHook: (hook: HookResult) => void;
}

export function FavoritesDrawer({
  open,
  onClose,
  history,
  favoritedIds,
  onToggleFavorite,
  onToggleAdopted,
  onSetSatisfaction,
  onCopyHook,
}: FavoritesDrawerProps) {
  const favoritedHooks = history
    .flatMap((item) =>
      item.hooks.map((hook) => ({
        ...hook,
        topic: item.topic,
        platform: item.platform,
      })),
    )
    .filter((hook) => favoritedIds.includes(hook.id));

  const handleCopy = async (hook: (typeof favoritedHooks)[number]) => {
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
    onCopyHook(hook);
  };

  return (
    <DrawerShell
      description={`${favoritedHooks.length} 个可复用候选`}
      onClose={onClose}
      open={open}
      title="收藏夹"
    >
      {favoritedHooks.length === 0 ? (
        <div className="grid min-h-56 place-items-center px-6 text-center">
          <div>
            <Heart aria-hidden="true" className="mx-auto text-[var(--color-line-strong)]" size={30} />
            <p className="mt-4 text-sm font-extrabold">还没有收藏的 Hook</p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">在候选中点击收藏，把好开头沉淀为创作资产。</p>
          </div>
        </div>
      ) : (
        <div>
          {favoritedHooks.map((hook) => (
            <article className="border-b border-[var(--color-line)] p-5 last:border-b-0 md:p-6" key={hook.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-bold">
                  <span className="text-[var(--color-accent)]">{hook.style}</span>
                  <span className="text-[var(--color-muted)]">{PLATFORM_CONFIG[hook.platform]?.label}</span>
                </div>
                <span className="text-xs font-black tabular-nums">{hook.overallScore ?? hook.score ?? "?"}/10</span>
              </div>
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--color-ink)]">{hook.text}</p>
              <p className="mt-2 truncate text-[11px] text-[var(--color-muted)]">主题：{hook.topic}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button className="button-secondary" onClick={() => handleCopy(hook)} type="button">
                  <Copy aria-hidden="true" size={15} weight="bold" />复制
                </button>
                <button
                  aria-pressed={Boolean(hook.adopted)}
                  className={`button-secondary ${hook.adopted ? "border-[var(--color-success)] text-[var(--color-success)]" : ""}`}
                  onClick={() => onToggleAdopted(hook.id)}
                  type="button"
                >
                  <CheckCircle aria-hidden="true" size={15} weight={hook.adopted ? "fill" : "bold"} />
                  {hook.adopted ? "已采用" : "标记采用"}
                </button>
                <button
                  aria-label="取消收藏"
                  className="button-secondary border-[var(--color-accent)] text-[var(--color-accent)]"
                  onClick={() => onToggleFavorite(hook.id)}
                  type="button"
                >
                  <Heart aria-hidden="true" size={15} weight="fill" />取消收藏
                </button>
              </div>

              <fieldset className="mt-4">
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
              </fieldset>
            </article>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}
