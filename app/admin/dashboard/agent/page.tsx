import type { Metadata } from "next";
import { forbidden, notFound, redirect } from "next/navigation";
import { Flask } from "@phosphor-icons/react/dist/ssr";

import { AppHeader } from "@/components/AppHeader";
import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { OpsAgentChat } from "@/components/OpsAgentChat";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "运营分析 Agent | AI Hook Lab",
  description: "查询运营看板与评测数据，诊断 Bad Case 并提出待验证的 Prompt 优化建议。",
};

export default async function OpsAgentPage() {
  if (!isOpsAgentEnabled()) notFound();
  if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard%2Fagent");
  if (access === "forbidden") forbidden();
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
        <header className="mb-6 grid gap-5 border-b border-[var(--color-line-strong)] pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div><p className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]"><Flask aria-hidden="true" size={15} weight="bold" />仅管理员可见</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">运营分析 Agent</h1><p className="mt-3 max-w-[72ch] text-sm leading-6 text-[var(--color-graphite)]">用对话查询看板和评测证据，定位质量问题，形成可验证的下一步动作。</p></div>
          <p className="max-w-64 text-xs leading-5 text-[var(--color-muted)]">只读工具 · 24 小时会话 · 数字结论关联数据来源</p>
        </header>
        <OpsAgentChat />
      </main>
    </div>
  );
}
