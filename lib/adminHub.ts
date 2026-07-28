export interface AdminHubFlags {
  opsAgentEnabled: boolean;
  strategyCardsEnabled: boolean;
}

export interface AdminHubItem {
  title: string;
  description: string;
  href: string;
  enabled: boolean;
}

export function getAdminHubItems(flags: AdminHubFlags): AdminHubItem[] {
  return [
    {
      title: "数据看板",
      description: "查看生成、采用、满意度和 Bad Case 等核心运营指标。",
      href: "/admin/dashboard",
      enabled: true,
    },
    {
      title: "策略治理",
      description: "审核策略卡、核对证据门禁并管理版本与有效期。",
      href: "/admin/dashboard/strategies",
      enabled: flags.strategyCardsEnabled,
    },
    {
      title: "运营 Agent",
      description: "基于只读证据分析运营问题并形成可审核的策略草稿。",
      href: "/admin/dashboard/agent",
      enabled: flags.opsAgentEnabled,
    },
    {
      title: "评测工作台",
      description: "运行固定案例评测，核对 Prompt 和策略版本的质量门禁。",
      href: "/evaluation",
      enabled: true,
    },
  ];
}
