import type { Metadata } from "next";
import { forbidden, notFound, redirect } from "next/navigation";
import { Flask } from "@phosphor-icons/react/dist/ssr";

import { AdminBackLink } from "@/components/AdminBackLink";
import { AdminWorkspaceHeader } from "@/components/AdminWorkspaceHeader";
import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { OpsAgentChat } from "@/components/OpsAgentChat";
import { classifyAdminAccess, isPublicWorkspaceReadEnabled } from "@/lib/adminAccess";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "运营分析 Agent | AI Hook Lab",
  description: "查询运营看板与评测数据，诊断 Bad Case 并提出待验证的 Prompt 优化建议。",
};

export default async function OpsAgentPage() {
  if (!isOpsAgentEnabled()) notFound();
  if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
  const publicRead = isPublicWorkspaceReadEnabled();
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (!publicRead) {
    if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard%2Fagent");
    if (access === "forbidden") forbidden();
  }
  const readOnly = access !== "authorized";
  return (
    <div className="min-h-screen">
      <AdminWorkspaceHeader
        opsAgentEnabled
        strategyCardsEnabled={isStrategyCardsEnabled()}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
        <AdminBackLink href="/admin" label="返回数据看板" />
        <header className="mb-6 mt-5 grid gap-5 border-b border-[var(--color-line-strong)] pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div><p className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]"><Flask aria-hidden="true" size={15} weight="bold" />{readOnly ? "公开只读" : "管理员模式"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">运营分析 Agent</h1><p className="mt-3 max-w-[72ch] text-sm leading-6 text-[var(--color-graphite)]">用对话查询看板和评测证据，定位质量问题，形成可验证的下一步动作。</p></div>
          <p className="max-w-64 text-xs leading-5 text-[var(--color-muted)]">只读工具 · 24 小时会话 · 数字结论关联数据来源</p>
        </header>
        <OpsAgentChat readOnly={readOnly} />
      </main>
    </div>
  );
}
