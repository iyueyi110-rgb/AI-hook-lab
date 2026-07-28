import type { Metadata } from "next";
import { forbidden, notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/AppHeader";
import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { StrategyAdminClient } from "@/components/StrategyAdminClient";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "策略治理 | AI Hook Lab",
  description: "管理员审核、评测、激活和归档版本化策略卡。",
};

export default async function StrategyAdminPage() {
  if (!isStrategyCardsEnabled()) notFound();
  if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard%2Fstrategies");
  if (access === "forbidden") forbidden();
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
        <header className="mb-6 border-b border-[var(--color-line-strong)] pb-6">
          <p className="text-xs font-extrabold text-[var(--color-accent)]">仅管理员可见 · 人工批准</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">策略治理</h1>
          <p className="mt-3 max-w-[76ch] text-sm leading-6 text-[var(--color-graphite)]">
            运营洞察先形成不可变草稿，经过人工审核和每个适用范围的固定盲评后，才允许进入创作 Agent。
          </p>
        </header>
        <StrategyAdminClient />
      </main>
    </div>
  );
}
