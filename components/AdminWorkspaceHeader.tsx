"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  ChartBar,
  Flask,
  PencilSimpleLine,
  Strategy,
} from "@phosphor-icons/react";

import {
  getAdminNavigationItems,
  isAdminNavigationItemCurrent,
  type AdminNavigationFlags,
} from "@/lib/adminNavigation";

const icons = {
  "/admin": ChartBar,
  "/admin/dashboard/strategies": Strategy,
  "/admin/dashboard/agent": Brain,
  "/evaluation": Flask,
};

export function AdminWorkspaceHeader(flags: AdminNavigationFlags) {
  const pathname = usePathname();
  const items = getAdminNavigationItems(flags);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color:rgb(245_245_243_/_0.94)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link
          aria-label="AI Hook Lab 创作台"
          className="flex h-16 shrink-0 items-center gap-2.5"
          href="/"
        >
          <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--color-accent)] text-sm font-black text-white">
            H
          </span>
          <span className="hidden text-sm font-black tracking-[-0.02em] sm:block">
            AI HOOK LAB
          </span>
        </Link>
        <Link
          className="hidden h-16 shrink-0 items-center gap-1.5 text-xs font-bold sm:flex"
          href="/"
        >
          <PencilSimpleLine aria-hidden="true" size={17} weight="bold" />
          创作台
        </Link>
        <nav
          aria-label="管理工具"
          className="ml-auto flex h-16 min-w-0 items-stretch gap-1 overflow-x-auto"
        >
          {items.map((item) => {
            const Icon = icons[item.href as keyof typeof icons];
            const current = isAdminNavigationItemCurrent(pathname, item.href);
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-1.5 px-2 text-xs font-bold sm:px-3 ${
                  current
                    ? "text-[var(--color-ink)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={16} weight="bold" />
                {item.title}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
