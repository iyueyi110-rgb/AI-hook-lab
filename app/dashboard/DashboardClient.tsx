"use client";

import { useCallback, useMemo, useState } from "react";
import type { DashboardSummary } from "@/lib/dashboardStore";

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
    dataOriginDistribution: { real_operation: 0, evaluation: 0, simulated: 0 },
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

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-gray-950">{value}</p>
      {hint && <p className="mt-2 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Distribution({
  title,
  items,
}: {
  title: string;
  items: Record<string, number>;
}) {
  const entries = Object.entries(items).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));

  return (
    <div className="border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">暂无数据</p>
      ) : (
        <div className="mt-4 space-y-3">
          {entries.map(([key, value]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-gray-600">{key}</span>
                <span className="font-semibold text-gray-900">{value}</span>
              </div>
              <div className="h-1.5 bg-gray-100">
                <div
                  className="h-1.5 bg-[#002FA7]"
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardClient({ initialSummary }: { initialSummary?: DashboardSummary }) {
  const [summary, setSummary] = useState<DashboardSummary>(initialSummary ?? emptySummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSummary((await res.json()) as DashboardSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const metricCards = useMemo(
    () => [
      {
        label: "生成完成率",
        value: `${summary.rates.completionRate}%`,
        hint: `${summary.totals.generationsCompleted}/${summary.totals.generationsStarted} 次`,
      },
      {
        label: "生成 Hook 数",
        value: String(summary.totals.hooksGenerated),
        hint: `${summary.totals.generationsCompleted} 组完成`,
      },
      {
        label: "收藏率",
        value: `${summary.rates.favoriteRate}%`,
        hint: `${summary.totals.hooksFavorited} 个收藏`,
      },
      {
        label: "采用率",
        value: `${summary.rates.adoptionRate}%`,
        hint: `${summary.totals.hooksAdopted} 个采用`,
      },
      {
        label: "复制率",
        value: `${summary.rates.copyRate}%`,
        hint: `${summary.totals.hooksCopied} 次复制`,
      },
      {
        label: "模型自评分均值",
        value: summary.averages.avgScore ? `${summary.averages.avgScore}/10` : "暂无",
        hint: "仅用于候选排序，不代表真实点击效果",
      },
      {
        label: "平台适配满意度",
        value: summary.averages.avgPlatformSatisfaction
          ? `${summary.averages.avgPlatformSatisfaction}/5`
          : "暂无",
        hint: `${summary.totals.satisfactionCount} 次评分`,
      },
      {
        label: "平均生成耗时",
        value: summary.averages.avgDurationMs
          ? `${Math.round(summary.averages.avgDurationMs / 1000)}s`
          : "暂无",
        hint: "接口请求耗时",
      },
    ],
    [summary]
  );

  return (
    <main className="min-h-screen bg-[#F7F7F8] text-gray-950">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <header className="border-b border-gray-200 bg-white px-5 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#002FA7]">AI Hook Lab</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">后端数据看板</h1>
              <p className="mt-2 text-sm text-gray-500">
                持久化事件数据：区分真实操作、评测集和模拟事件；模型自评分与人工反馈分开展示。
              </p>
            </div>
            <button
              type="button"
              onClick={loadSummary}
              disabled={loading}
              className="w-fit border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-[#002FA7] hover:text-[#002FA7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "刷新中" : "刷新数据"}
            </button>
          </div>
          {error && (
            <div className="mt-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </header>

        <section className="mt-5 grid grid-cols-1 gap-px bg-gray-200 md:grid-cols-4">
          {metricCards.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} hint={card.hint} />
          ))}
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Distribution title="平台分布" items={summary.platformDistribution} />
          <Distribution title="Bad case 分布" items={summary.badcaseDistribution} />
          <Distribution title="数据来源" items={summary.dataOriginDistribution} />
          <Distribution title="Prompt 版本" items={summary.promptVersionDistribution} />
        </section>

        <section className="mt-5 border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">最近事件</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">事件</th>
                  <th className="px-4 py-3 font-medium">数据来源</th>
                  <th className="px-4 py-3 font-medium">平台</th>
                  <th className="px-4 py-3 font-medium">数量/评分</th>
                  <th className="px-4 py-3 font-medium">Hook</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      暂无服务端事件
                    </td>
                  </tr>
                ) : (
                  summary.recentEvents.map((event) => (
                    <tr key={event.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-gray-500">{formatDate(event.timestamp)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {formatEventType(event.type)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{event.dataOrigin}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {String(event.payload?.platform ?? "-")}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {String(
                          event.payload?.hookCount ??
                            event.payload?.rating ??
                            event.payload?.avgScore ??
                            "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {String(event.payload?.hookId ?? "-")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
