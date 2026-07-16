"use client";

import { useState } from "react";
import {
  ClockCounterClockwise,
  Heart,
  Trash,
} from "@phosphor-icons/react";
import type { HistoryItem } from "@/lib/types";
import { CONTENT_TYPE_CONFIG, PLATFORM_CONFIG } from "@/lib/constants";
import { DrawerShell } from "./DrawerShell";

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
  const [deleting, setDeleting] = useState<string | null>(null);

  const clearAction = history.length > 0 ? (
    <button
      className="button-secondary h-9 min-h-9"
      onClick={() => {
        if (window.confirm("确定清空全部历史记录？此操作无法撤销。")) onClearAll();
      }}
      type="button"
    >
      <Trash aria-hidden="true" size={15} weight="bold" />
      清空
    </button>
  ) : undefined;

  return (
    <DrawerShell
      actions={clearAction}
      description={loaded ? `${history.length} 条生成记录` : "正在读取本地记录"}
      onClose={onClose}
      open={open}
      title="历史记录"
    >
      {!loaded ? (
        <div className="p-6 text-sm text-[var(--color-muted)]">正在加载历史记录…</div>
      ) : history.length === 0 ? (
        <div className="grid min-h-56 place-items-center px-6 text-center">
          <div>
            <ClockCounterClockwise aria-hidden="true" className="mx-auto text-[var(--color-line-strong)]" size={30} />
            <p className="mt-4 text-sm font-extrabold">还没有生成记录</p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">完成一次生成后，候选会自动保存在这里。</p>
          </div>
        </div>
      ) : (
        <div>
          {history.map((item) => (
            <details className="group border-b border-[var(--color-line)] px-5 py-4 last:border-b-0 md:px-6" key={item.id}>
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-[var(--color-ink)]">{item.topic}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
                      <span>{PLATFORM_CONFIG[item.platform]?.label}</span>
                      <span>{CONTENT_TYPE_CONFIG[item.contentType]?.label}</span>
                      <time dateTime={item.generatedAt}>
                        {new Date(item.generatedAt).toLocaleString("zh-CN", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </p>
                  </div>
                  <span className="text-xs font-bold text-[var(--color-muted)] group-open:text-[var(--color-ink)]">
                    {item.hooks.length} 个
                  </span>
                </div>
              </summary>

              <div className="mt-4 space-y-2">
                {item.hooks.map((hook) => (
                  <div className="rounded-[8px] bg-[var(--color-surface-subtle)] p-3" key={hook.id}>
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="font-bold text-[var(--color-accent)]">{hook.style}</span>
                      <span className="font-bold tabular-nums text-[var(--color-muted)]">
                        {hook.overallScore ?? hook.score ?? "?"}/10
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-ink)]">{hook.text}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2">
                  <button
                    aria-pressed={item.isFavorited}
                    className={`button-secondary ${item.isFavorited ? "border-[var(--color-accent)] text-[var(--color-accent)]" : ""}`}
                    onClick={() => onToggleFavorite(item.id)}
                    type="button"
                  >
                    <Heart aria-hidden="true" size={15} weight={item.isFavorited ? "fill" : "bold"} />
                    {item.isFavorited ? "已收藏" : "收藏本次"}
                  </button>
                  <button
                    className="button-secondary text-[var(--color-danger)]"
                    disabled={deleting === item.id}
                    onClick={async () => {
                      setDeleting(item.id);
                      await new Promise((resolve) => setTimeout(resolve, 160));
                      onDelete(item.id);
                      setDeleting(null);
                    }}
                    type="button"
                  >
                    <Trash aria-hidden="true" size={15} weight="bold" />
                    {deleting === item.id ? "删除中" : "删除"}
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}
