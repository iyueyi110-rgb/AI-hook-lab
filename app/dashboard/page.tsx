import { DashboardClient } from "./DashboardClient";
import { getDashboardSummary } from "@/lib/dashboardStore";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板 | AI Hook Lab",
  description: "查看 AI Hook Lab 的生成健康度、内容价值与人工反馈。",
};

export default async function DashboardPage() {
  const summary = await getDashboardSummary();
  return <DashboardClient initialSummary={summary} />;
}
