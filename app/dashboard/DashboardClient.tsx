"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  ChartLineUp,
  CheckCircle,
  CursorClick,
  Database,
  Flask,
  Heart,
  Timer,
  WarningCircle,
} from "@phosphor-icons/react";
import { AppHeader } from "@/components/AppHeader";
import type { DashboardSummary } from "@/lib/dashboardStore";
import type { DataOrigin } from "@/lib/evaluation/types";

function emptySummary(): DashboardSummary {
  return {
    totals: {
      events: 0,
      generationsStarted: 0,
      generationsCompleted: 0,
      generationsFailed: 0,
      hooksGenerated: 0,
      hooksCopied: 0,
      hooksFavorited: 0,
      hooksAdopted: 0,
      satisfactionCount: 0,
    },
    rates: {
      completionRate: 0,
      favoriteRate: 0,
      adoptionRate: 0,
      copyRate: 0,
    },
    averages: {
      avgScore: 0,
      avgDurationMs: 0,
      avgPlatformSatisfaction: 0,
    },
    platformDistribution: {},
    promptVersionDistribution: {},
    dataOriginDistribution: { real_user: 0, evaluation_set: 0, simulation: 0 },
    badcaseDistribution: {},
    platformMetrics: {},
    recentEvents: [],
  };
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    generation_start: "生成开始",
    generation_complete: "生成完成",
    generation_error: "生成失败",
    hook_copied: "复制 Hook",
    hook_favorited: "收藏 Hook",
    hook_unfavorited: "取消收藏",
    hook_adopted: "标记采用",
    hook_unadopted: "取消采用",
    platform_satisfaction: "平台满意度",
  };
  return labels[type] ?? type;
}

function formatOrigin(origin: string): string {
  return {
    real_user: "真实用户",
    evaluation_set: "离线评测",
    simulation: "模拟事件",
  }[origin] ?? origin;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Metric {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}

function MetricGroup({ title, description, metrics }: { title: string; description: string; metrics: Metric[] }) {
  return (
    <section className="editorial-panel overflow-hidden" aria-labelledby={`metric-${title}`}>
      <div className="border-b border-[var(--color-line)] p-4">
        <h2 className="text-sm font-black" id={`metric-${title}`}>{title}</h2>
        <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted)]">{description}</p>
      </div>
      <div className="divide-y divide-[var(--color-line)]">
        {metrics.map((metric) => (
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5" key={metric.label}>
            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--color-surface-subtle)] text-[var(--color-graphite)]">
              {metric.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--color-graphite)]">{metric.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">{metric.hint}</p>
            </div>
            <p className="text-xl font-black tabular-nums tracking-[-0.035em]">{metric.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Distribution({ title, description, items, formatKey }: {
  title: string;
  description: string;
  items: Record<string, number>;
  formatKey?: (key: string) => string;
}) {
  const entries = Object.entries(items).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const hasData = entries.some(([, value]) => value > 0);

  return (
    <section className="editorial-panel p-4 sm:p-5">
      <h2 className="text-sm font-black">{title}</h2>
      <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted)]">{description}</p>
      {!hasData ? (
        <div className="mt-6 rounded-[8px] bg-[var(--color-surface-subtle)] px-4 py-5 text-center text-xs text-[var(--color-muted)]">
          暂无可展示数据
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {entries.filter(([, value]) => value > 0).map(([key, value]) => (
            <div key={key}>
              <div className="mb-1.5 flex items-center justify-between gap-4 text-xs">
                <span className="truncate font-semibold text-[var(--color-graphite)]">{formatKey?.(key) ?? key}</span>
                <span className="font-black tabular-nums">{value}</span>
              </div>
              <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]">
                <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${(value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DashboardClient({ initialSummary }: { initialSummary?: DashboardSummary }) {
  const [summary, setSummary] = useState<DashboardSummary>(initialSummary ?? emptySummary);
  const [origin, setOrigin] = useState<DataOrigin>("real_user");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard/summary?origin=${origin}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSummary((await response.json()) as DashboardSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [origin]);

  const metricGroups = useMemo(
    () => [
      {
        title: "生成健康度",
        description: "判断服务是否稳定完成创作请求。",
        metrics: [
          {
            label: "生成完成率",
            value: `${summary.rates.completionRate}%`,
            hint: `${summary.totals.generationsCompleted}/${summary.totals.generationsStarted} 次完成`,
            icon: <CheckCircle aria-hidden="true" size={17} weight="bold" />,
          },
          {
            label: "生成 Hook 数",
            value: String(summary.totals.hooksGenerated),
            hint: `${summary.totals.generationsCompleted} 组生成`,
            icon: <ChartLineUp aria-hidden="true" size={17} weight="bold" />,
          },
          {
            label: "平均生成耗时",
            value: summary.averages.avgDurationMs ? `${Math.round(summary.averages.avgDurationMs / 1000)}s` : "暂无",
            hint: "接口请求耗时",
            icon: <Timer aria-hidden="true" size={17} weight="bold" />,
          },
        ],
      },
      {
        title: "内容价值",
        description: "观察候选是否进入真实创作流程。",
        metrics: [
          {
            label: origin === "real_user" ? "真实收藏率" : origin === "evaluation_set" ? "评测收藏事件率" : "模拟收藏事件率",
            value: `${summary.rates.favoriteRate}%`,
            hint: `${summary.totals.hooksFavorited} 个收藏`,
            icon: <Heart aria-hidden="true" size={17} weight="bold" />,
          },
          {
            label: origin === "real_user" ? "真实采用率" : origin === "evaluation_set" ? "评测采用事件率" : "模拟采用事件率",
            value: `${summary.rates.adoptionRate}%`,
            hint: `${summary.totals.hooksAdopted} 个采用`,
            icon: <CheckCircle aria-hidden="true" size={17} weight="bold" />,
          },
          {
            label: "复制率",
            value: `${summary.rates.copyRate}%`,
            hint: `${summary.totals.hooksCopied} 次复制`,
            icon: <CursorClick aria-hidden="true" size={17} weight="bold" />,
          },
        ],
      },
      {
        title: "人工反馈",
        description: "模型自评分与人工判断分开展示。",
        metrics: [
          {
            label: "模型自评分均值",
            value: summary.averages.avgScore ? `${summary.averages.avgScore}/10` : "暂无",
            hint: "仅用于候选排序，不代表点击效果",
            icon: <Flask aria-hidden="true" size={17} weight="bold" />,
          },
          {
            label: "平台适配满意度",
            value: summary.averages.avgPlatformSatisfaction ? `${summary.averages.avgPlatformSatisfaction}/5` : "暂无",
            hint: `${summary.totals.satisfactionCount} 次人工评分`,
            icon: <Database aria-hidden="true" size={17} weight="bold" />,
          },
        ],
      },
    ],
    [origin, summary],
  );

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
        <header className="flex flex-col gap-5 border-b border-[var(--color-line-strong)] pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]">
              <Flask aria-hidden="true" size={16} weight="bold" />运营实验
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl">数据看板</h1>
            <p className="mt-3 max-w-[72ch] text-sm leading-6 text-[var(--color-graphite)]">
              区分真实操作、评测集和模拟事件；模型自评分与人工反馈分别解释，不混算成效果结论。
            </p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">
            <label className="sr-only" htmlFor="dashboard-origin">数据来源</label>
            <select className="control-base min-h-10 px-3 text-xs font-bold" id="dashboard-origin" onChange={(event) => setOrigin(event.target.value as DataOrigin)} value={origin}>
              <option value="real_user">真实用户数据</option>
              <option value="evaluation_set">离线评测数据</option>
              <option value="simulation">模拟事件</option>
            </select>
            <button className="button-secondary" disabled={loading} onClick={loadSummary} type="button">
              <ArrowClockwise aria-hidden="true" className={loading ? "animate-spin" : ""} size={16} weight="bold" />
              {loading ? "刷新中" : "刷新数据"}
            </button>
          </div>
        </header>

        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-[10px] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4 text-sm text-[var(--color-danger)]" role="alert">
            <WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} weight="fill" />
            <div><p className="font-bold">刷新失败</p><p className="mt-1 text-xs">{error}</p></div>
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {metricGroups.map((group) => <MetricGroup {...group} key={group.title} />)}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Distribution description="不同发布平台的生成事件分布。" items={summary.platformDistribution} title="平台分布" />
          <Distribution description="用于定位 Prompt 与内容质量问题。" items={summary.badcaseDistribution} title="Bad Case 分布" />
          <Distribution description="真实操作、评测集和模拟事件严格隔离。" formatKey={formatOrigin} items={summary.dataOriginDistribution} title="数据来源" />
          <Distribution description="比较 baseline 与 candidate 的运行覆盖。" items={summary.promptVersionDistribution} title="Prompt 版本" />
        </div>

        <section className="editorial-panel mt-6 overflow-hidden">
          <div className="border-b border-[var(--color-line)] px-4 py-4 sm:px-5">
            <h2 className="text-sm font-black">最近事件</h2>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">按时间查看真实操作与评测行为。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-subtle)] text-[var(--color-muted)]">
                  <th className="px-4 py-3 font-bold">时间</th>
                  <th className="px-4 py-3 font-bold">事件</th>
                  <th className="px-4 py-3 font-bold">数据来源</th>
                  <th className="px-4 py-3 font-bold">平台</th>
                  <th className="px-4 py-3 font-bold">数量 / 评分</th>
                  <th className="px-4 py-3 font-bold">Hook</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentEvents.length === 0 ? (
                  <tr><td className="px-4 py-10 text-center text-[var(--color-muted)]" colSpan={6}>暂无服务端事件</td></tr>
                ) : (
                  summary.recentEvents.map((event) => (
                    <tr className="border-b border-[var(--color-line)] last:border-b-0 hover:bg-[#fafaf8]" key={event.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--color-muted)]">{formatDate(event.timestamp)}</td>
                      <td className="px-4 py-3 font-bold">{formatEventType(event.type)}</td>
                      <td className="px-4 py-3 text-[var(--color-graphite)]">{formatOrigin(event.dataOrigin)}</td>
                      <td className="px-4 py-3 text-[var(--color-graphite)]">{String(event.payload?.platform ?? "-")}</td>
                      <td className="px-4 py-3 text-[var(--color-graphite)]">{String(event.payload?.hookCount ?? event.payload?.rating ?? event.payload?.avgScore ?? "-")}</td>
                      <td className="max-w-48 truncate px-4 py-3 text-[var(--color-muted)]">{String(event.payload?.hookId ?? "-")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
