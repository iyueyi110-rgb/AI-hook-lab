import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { classifyAdminAccess } from "@/lib/adminAccess";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板 | AI Hook Lab",
  description: "查看 AI Hook Lab 的生成健康度、内容价值与人工反馈。",
};

export default async function AdminDashboardPage() {
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard");
  if (access === "forbidden") forbidden();
  return <DashboardClient initialSummary={await getDashboardSummary()} />;
}
