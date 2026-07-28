"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { ContentType, Platform } from "@/lib/types";
import type {
  StrategyCard,
  StrategyEvidence,
  StrategyScopePair,
  StrategyVersion,
} from "@/lib/strategy/types";

interface StrategyListItem {
  card: StrategyCard;
  versions: StrategyVersion[];
  evidence: StrategyEvidence[];
  readiness: Record<number, {
    ready: boolean;
    missingScopePairs: StrategyScopePair[];
    evidenceIds: string[];
  }>;
}

const STATUS_LABEL: Record<StrategyVersion["status"], string> = {
  draft: "草稿",
  pending_review: "待审核",
  approved_experiment: "已批准评测",
  active: "使用中",
  rejected: "已拒绝",
  archived: "已归档",
};

async function responseJson(response: Response) {
  const body = await response.json() as { error?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? "操作失败");
  return body;
}

export function StrategyAdminClient() {
  const [items, setItems] = useState<StrategyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<Record<string, { before: unknown; after: unknown }> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/strategies", { cache: "no-store" });
      const body = await responseJson(response) as { strategies?: StrategyListItem[] };
      setItems(body.strategies ?? []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      title: String(form.get("title") ?? ""),
      scopePairs: [{
        platform: String(form.get("platform")) as Platform,
        contentType: String(form.get("contentType")) as ContentType,
      }],
      audienceLabel: String(form.get("audienceLabel") ?? ""),
      guidance: {
        do: [String(form.get("do") ?? "")],
        avoid: String(form.get("avoid") ?? "").trim() ? [String(form.get("avoid"))] : [],
      },
      hypothesis: String(form.get("hypothesis") ?? ""),
    };
    try {
      await responseJson(await fetch("/api/admin/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    }
  }

  async function action(version: StrategyVersion, actionName: string) {
    try {
      await responseJson(await fetch(`/api/admin/strategies/${encodeURIComponent(version.cardId)}/versions/${version.version}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          expectedRevision: version.revision,
          ...(actionName === "activate" ? { expiresInDays: 30 } : {}),
          ...(actionName === "reject" ? { reason: "管理员审核拒绝" } : {}),
        }),
      }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    }
  }

  async function clone(version: StrategyVersion) {
    try {
      await responseJson(await fetch(`/api/admin/strategies/${encodeURIComponent(version.cardId)}/versions/${version.version}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "克隆失败");
    }
  }

  async function showDiff(version: StrategyVersion, against: number) {
    try {
      const body = await responseJson(await fetch(
        `/api/admin/strategies/${encodeURIComponent(version.cardId)}/versions/${version.version}/diff?against=${against}`,
        { cache: "no-store" },
      )) as { diff?: Record<string, { before: unknown; after: unknown }> };
      setDiff(body.diff ?? {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取版本差异失败");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="editorial-panel p-5 lg:sticky lg:top-20 lg:self-start">
        <h2 className="text-sm font-black">新建人工草稿</h2>
        <form className="mt-4 space-y-3" onSubmit={create}>
          <label className="block text-xs font-bold">标题<input className="control-base mt-1 w-full px-3 py-2" maxLength={80} name="title" required /></label>
          <label className="block text-xs font-bold">平台<select className="control-base mt-1 w-full px-3 py-2" name="platform"><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="bilibili">B站</option><option value="youtube">YouTube</option><option value="x">X</option></select></label>
          <label className="block text-xs font-bold">内容类型<select className="control-base mt-1 w-full px-3 py-2" name="contentType"><option value="tutorial">教程</option><option value="video">视频</option><option value="image-text">图文</option><option value="product-ad">产品推广</option><option value="opinion">观点</option></select></label>
          <label className="block text-xs font-bold">建议受众<input className="control-base mt-1 w-full px-3 py-2" maxLength={60} name="audienceLabel" /></label>
          <label className="block text-xs font-bold">应该做<input className="control-base mt-1 w-full px-3 py-2" maxLength={160} name="do" required /></label>
          <label className="block text-xs font-bold">应该避免<input className="control-base mt-1 w-full px-3 py-2" maxLength={160} name="avoid" /></label>
          <label className="block text-xs font-bold">验证假设<textarea className="control-base mt-1 min-h-20 w-full px-3 py-2" maxLength={300} name="hypothesis" required /></label>
          <button className="button-primary w-full" type="submit">保存草稿</button>
        </form>
      </aside>

      <section>
        <div className="mb-4 border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-xs leading-5">
          <p className="font-black">观察性数据，不代表因果</p>
          <p>未经生产随机对照验证，不能把选择率、采用率或 helpful 反馈解释为策略提升效果。</p>
        </div>
        {error && <p className="mb-4 rounded-[8px] bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]" role="alert">{error}</p>}
        {loading ? <p className="text-sm text-[var(--color-muted)]">正在读取策略…</p> : items.length === 0 ? <div className="editorial-panel p-10 text-center text-sm text-[var(--color-muted)]">暂无策略卡。</div> : (
          <div className="space-y-4">
            {items.map(({ card, versions, evidence, readiness }) => {
              const version = versions[0]!;
              const gate = readiness[version.version];
              return (
                <article className="editorial-panel p-5" key={card.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-[10px] font-black text-[var(--color-accent)]">{STATUS_LABEL[version.status]} · v{version.version}</p><h2 className="mt-1 text-lg font-black">{version.title}</h2><p className="mt-2 text-xs text-[var(--color-muted)]">{version.scopePairs.map((pair) => `${pair.platform}/${pair.contentType}`).join("、")}</p></div>
                    <p className="text-[10px] text-[var(--color-muted)]">revision {version.revision}</p>
                  </div>
                  <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                    <div><p className="font-black">执行建议</p>{version.guidance.do.map((item) => <p className="mt-1" key={item}>+ {item}</p>)}</div>
                    <div><p className="font-black">规避项</p>{version.guidance.avoid.length ? version.guidance.avoid.map((item) => <p className="mt-1" key={item}>− {item}</p>) : <p className="mt-1 text-[var(--color-muted)]">无</p>}</div>
                  </div>
                  <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs leading-5"><span className="font-black">假设：</span>{version.hypothesis}</p>
                  <div className="mt-3 rounded-[8px] bg-[var(--color-surface-subtle)] p-3 text-xs leading-5">
                    <p className="font-black">证据与激活门禁</p>
                    <p className="mt-1">
                      {gate?.ready
                        ? `全部范围最近一次完整 Live 盲评已通过（${gate.evidenceIds.length} 份快照）`
                        : `尚缺少通过门禁的范围：${gate?.missingScopePairs.map((pair) => `${pair.platform}/${pair.contentType}`).join("、") || "当前状态不可激活"}`}
                    </p>
                    <p className="mt-1 text-[var(--color-muted)]">
                      当前版本证据 {evidence.filter((item) => item.strategyVersion === version.version).length} 份；模拟与观察性数据不能单独激活。
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {version.status === "draft" && <button className="button-secondary" onClick={() => void action(version, "submit_review")} type="button">提交审核</button>}
                    {version.status === "pending_review" && <><button className="button-primary" onClick={() => void action(version, "approve_experiment")} type="button">批准离线评测</button><button className="button-secondary" onClick={() => void action(version, "reject")} type="button">拒绝</button></>}
                    {version.status === "approved_experiment" && version.scopePairs.map((pair) => (
                      <a
                        className="button-secondary"
                        href={`/evaluation?strategyCardId=${encodeURIComponent(version.cardId)}&strategyCardVersion=${version.version}&platform=${encodeURIComponent(pair.platform)}&contentType=${encodeURIComponent(pair.contentType)}`}
                        key={`${pair.platform}:${pair.contentType}`}
                      >
                        创建 {pair.platform}/{pair.contentType} 20 主题 Live 盲评
                      </a>
                    ))}
                    {version.status === "approved_experiment" && <button className="button-primary" disabled={!gate?.ready} onClick={() => void action(version, "activate")} type="button">验证门禁并激活</button>}
                    {(version.status === "approved_experiment" || version.status === "active") && <button className="button-secondary" onClick={() => void action(version, "archive")} type="button">归档</button>}
                    <button className="button-secondary" onClick={() => void clone(version)} type="button">克隆新版本</button>
                    {versions.length > 1 && <button className="button-secondary" onClick={() => void showDiff(version, versions[1]!.version)} type="button">版本差异</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {diff && <section className="editorial-panel mt-4 p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-black">版本差异</h2><button className="button-secondary" onClick={() => setDiff(null)} type="button">关闭</button></div><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(diff, null, 2)}</pre></section>}
      </section>
    </div>
  );
}
