import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AppHeader } from "@/components/AppHeader";
import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { getAdminHubItems } from "@/lib/adminHub";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "管理中心 | AI Hook Lab",
  description: "集中进入数据看板、策略治理、运营分析和评测工作台。",
};

export default async function AdminPage() {
  if (getPersistenceMode() === "unavailable") {
    return <DatabaseUnavailablePanel />;
  }

  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") {
    redirect("/evaluation/login?next=%2Fadmin");
  }
  if (access === "forbidden") {
    forbidden();
  }

  const items = getAdminHubItems({
    opsAgentEnabled: isOpsAgentEnabled(),
    strategyCardsEnabled: isStrategyCardsEnabled(),
  });

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 pb-20 md:px-6">
        <header className="border-b border-[var(--color-line-strong)] pb-6">
          <p className="text-xs font-extrabold text-[var(--color-accent)]">
            仅管理员可见
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
            管理中心
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-graphite)]">
            在一个入口管理数据、策略、运营分析与评测流程。
          </p>
        </header>

        <section
          className="mt-6 grid gap-4 md:grid-cols-2"
          aria-label="管理工具"
        >
          {items.map((item) =>
            item.enabled ? (
              <Link
                className="editorial-panel block p-5 transition hover:-translate-y-0.5"
                href={item.href}
                key={item.href}
              >
                <h2 className="text-lg font-black">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">
                  {item.description}
                </p>
                <p className="mt-5 text-xs font-extrabold text-[var(--color-accent)]">
                  打开工具 →
                </p>
              </Link>
            ) : (
              <article
                className="editorial-panel p-5 opacity-65"
                key={item.href}
              >
                <h2 className="text-lg font-black">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">
                  {item.description}
                </p>
                <p className="mt-5 text-xs font-extrabold text-[var(--color-muted)]">
                  当前未启用
                </p>
              </article>
            ),
          )}
        </section>
      </main>
    </div>
  );
}
