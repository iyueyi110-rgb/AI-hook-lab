import { permanentRedirect } from "next/navigation";

export default function LegacyAdminDashboardPage() {
  permanentRedirect("/admin");
}
