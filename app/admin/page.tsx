import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import {
  classifyAdminAccess,
  isPublicDashboardEnabled,
} from "@/lib/adminAccess";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
import { DashboardClient } from "./dashboard/DashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板 | AI Hook Lab",
  description: "查看 AI Hook Lab 的生成健康度、内容价值与人工反馈。",
};

export default async function AdminPage() {
  if (getPersistenceMode() === "unavailable") {
    return <DatabaseUnavailablePanel />;
  }

  const publicDashboard = isPublicDashboardEnabled();
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (!publicDashboard) {
    if (access === "unauthenticated") {
      redirect("/evaluation/login?next=%2Fadmin");
    }
    if (access === "forbidden") forbidden();
  }

  return (
    <DashboardClient
      adminNavigation={access === "authorized"}
      initialSummary={await getDashboardSummary()}
      opsAgentEnabled={isOpsAgentEnabled()}
      strategyCardsEnabled={isStrategyCardsEnabled()}
    />
  );
}
