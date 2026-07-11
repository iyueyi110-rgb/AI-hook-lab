"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartBar,
  ClockCounterClockwise,
  Heart,
  PencilSimpleLine,
} from "@phosphor-icons/react";

interface AppHeaderProps {
  historyCount?: number;
  favoritesCount?: number;
  onOpenHistory?: () => void;
  onOpenFavorites?: () => void;
}

export function AppHeader({
  historyCount = 0,
  favoritesCount = 0,
  onOpenHistory,
  onOpenFavorites,
}: AppHeaderProps) {
  const pathname = usePathname();
  const onDashboard = pathname.startsWith("/dashboard");

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color:rgb(245_245_243_/_0.94)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 md:px-6">
        <Link
          aria-label="AI Hook Lab 创作台"
          className="flex shrink-0 items-center gap-2.5"
          href="/"
        >
          <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--color-accent)] text-sm font-black text-white">
            H
          </span>
          <span className="hidden text-sm font-black tracking-[-0.02em] text-[var(--color-ink)] sm:block">
            AI HOOK LAB
          </span>
        </Link>

        <nav aria-label="主导航" className="ml-1 flex h-full items-center gap-1 sm:ml-4">
          <Link
            aria-current={!onDashboard ? "page" : undefined}
            className={`relative flex h-full items-center gap-1.5 px-2 text-xs font-bold sm:px-3 sm:text-sm ${
              !onDashboard
                ? "text-[var(--color-ink)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
            href="/"
          >
            <PencilSimpleLine aria-hidden="true" size={17} weight="bold" />
            创作台
          </Link>
          <Link
            aria-current={onDashboard ? "page" : undefined}
            className={`relative flex h-full items-center gap-1.5 px-2 text-xs font-bold sm:px-3 sm:text-sm ${
              onDashboard
                ? "text-[var(--color-ink)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
            href="/dashboard"
          >
            <ChartBar aria-hidden="true" size={17} weight="bold" />
            <span className="hidden min-[430px]:inline">数据看板</span>
            <span className="min-[430px]:hidden">看板</span>
          </Link>
        </nav>

        {(onOpenHistory || onOpenFavorites) && (
          <div className="ml-auto flex items-center gap-1.5">
            {onOpenHistory && (
              <button
                aria-label={`历史记录${historyCount ? `，${historyCount} 条` : ""}`}
                className="button-secondary h-9 min-h-9 px-2.5"
                onClick={onOpenHistory}
                type="button"
              >
                <ClockCounterClockwise aria-hidden="true" size={17} weight="bold" />
                <span className="hidden md:inline">历史</span>
                {historyCount > 0 && <span className="text-[var(--color-muted)]">{historyCount}</span>}
              </button>
            )}
            {onOpenFavorites && (
              <button
                aria-label={`收藏夹${favoritesCount ? `，${favoritesCount} 条` : ""}`}
                className="button-secondary h-9 min-h-9 px-2.5"
                onClick={onOpenFavorites}
                type="button"
              >
                <Heart aria-hidden="true" size={17} weight="bold" />
                <span className="hidden md:inline">收藏</span>
                {favoritesCount > 0 && <span className="text-[var(--color-muted)]">{favoritesCount}</span>}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
