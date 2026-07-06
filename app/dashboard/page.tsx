import { DashboardClient } from "./DashboardClient";
import { getDashboardSummary } from "@/lib/dashboardStore";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const summary = await getDashboardSummary();
  return <DashboardClient initialSummary={summary} />;
}
