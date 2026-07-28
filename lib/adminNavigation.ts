export interface AdminNavigationFlags {
  opsAgentEnabled: boolean;
  strategyCardsEnabled: boolean;
}

export interface AdminNavigationItem {
  title: string;
  href: string;
  enabled: boolean;
  match: "exact" | "prefix";
}

export function getAdminNavigationItems(
  flags: AdminNavigationFlags,
): AdminNavigationItem[] {
  return [
    { title: "数据看板", href: "/admin", enabled: true, match: "exact" },
    {
      title: "策略治理",
      href: "/admin/dashboard/strategies",
      enabled: flags.strategyCardsEnabled,
      match: "prefix",
    },
    {
      title: "运营 Agent",
      href: "/admin/dashboard/agent",
      enabled: flags.opsAgentEnabled,
      match: "prefix",
    },
    {
      title: "评测工作台",
      href: "/evaluation",
      enabled: true,
      match: "prefix",
    },
  ].filter((item) => item.enabled);
}

export function isAdminNavigationItemCurrent(
  pathname: string,
  href: string,
): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
