"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, ChartBar, Database, Flask, Plus, ShieldCheck, SignOut, UsersThree } from "@phosphor-icons/react";

import { AppHeader } from "@/components/AppHeader";
import type { EvaluationCase, PromptVersion, UserRole } from "@/lib/evaluation/types";

interface PublicUser { id: string; username: string; displayName: string; role: UserRole; status: string; }
interface RunSummary { id: string; runName: string; status: string; executionMode: string; dataOrigin: string; caseCount: number; generatedTasks: number; totalGenerationTasks: number; candidateCount: number; selectedCount: number; primaryReviewCount: number; pairwiseReviewCount: number; adjudicationCount: number; createdAt: string; updatedAt: string; }
interface InitialState { user: PublicUser; storageMode: string; cases: EvaluationCase[]; promptVersions: PromptVersion[]; users: PublicUser[]; runs: RunSummary[]; }

export function EvaluationClient({ initial }: { initial: InitialState }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const evaluators = initial.users.filter((item) => item.role === "evaluator" && item.status === "active");
  const adjudicators = initial.users.filter((item) => item.role === "adjudicator" && item.status === "active");

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/evaluation/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "账号创建失败");
    router.refresh();
  }

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/evaluation/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runName: form.get("runName"), executionMode: form.get("executionMode"),
        evaluatorIds: [form.get("evaluatorA"), form.get("evaluatorB")], adjudicatorId: form.get("adjudicatorId"),
        modelName: "deepseek-chat", modelParameters: { temperature: 0.7, max_tokens: 2048 },
        baselinePromptId: form.get("baselinePromptId"), candidatePromptId: form.get("candidatePromptId"),
      }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "批次创建失败");
    router.push(`/evaluation/runs/${result.run.id}`);
  }

  async function createPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/evaluation/prompts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(form), modelName: "deepseek-chat", modelParameters: { temperature: 0.7 } }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "Prompt 创建失败");
    router.refresh();
  }

  async function setBaseline(promptId: string) {
    const response = await fetch("/api/evaluation/prompts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-baseline", promptId }) });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "Baseline 设置失败");
    router.refresh();
  }

  async function updateAccount(userId: string, input: { status?: string; password?: string }) {
    const response = await fetch("/api/evaluation/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, ...input }) });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "账号更新失败");
    router.refresh();
  }

  async function logout() {
    await fetch("/api/evaluation/auth/logout", { method: "POST" });
    router.push("/evaluation/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl px-4 py-7 pb-20 md:px-6">
        <header className="flex flex-col gap-5 border-b border-[var(--color-line-strong)] pb-6 md:flex-row md:items-end md:justify-between">
          <div><p className="flex items-center gap-2 text-xs font-black text-[var(--color-accent)]"><Flask size={16} weight="bold" />离线人工评测 · evaluation_set</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Prompt 升级证据台</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-graphite)]">固定输入、同模型参数、双人独立评分和持久化盲评，共同决定 candidate 是否值得升级。</p></div>
          <div className="flex items-center gap-2"><span className="control-base inline-flex min-h-10 items-center gap-2 px-3 text-xs font-bold"><Database size={15} />{initial.storageMode === "postgres" ? "PostgreSQL 正式存储" : "本地 JSON 存储"}</span>{initial.user.role === "admin" && (<Link className="button-secondary" href="/admin/dashboard"><ChartBar size={16} />数据看板</Link>)}<button className="button-secondary" onClick={logout} type="button"><SignOut size={16} />退出</button></div>
        </header>

        <section className="mt-6 grid overflow-hidden rounded-[14px] border border-[var(--color-ink)] bg-[var(--color-ink)] text-white sm:grid-cols-4">
          {[['固定案例','60','20 主题 × 3 平台'],['候选产出','360','每版本每案例 3 条'],['正式结果','120','人工筛选后进入评分'],['盲评案例','60','双人独立，分歧裁决']].map(([label,value,hint]) => <div className="border-b border-white/15 p-4 last:border-0 sm:border-b-0 sm:border-r" key={label}><p className="text-[11px] font-bold text-white/55">{label}</p><p className="mt-2 text-3xl font-black tracking-[-0.05em]">{value}</p><p className="mt-1 text-[11px] text-white/60">{hint}</p></div>)}
        </section>

        {error && <p className="mt-5 rounded-[10px] bg-[var(--color-danger-soft)] p-4 text-sm font-bold text-[var(--color-danger)]" role="alert">{error}</p>}

        {initial.user.role === "admin" && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="editorial-panel p-5"><div className="flex items-center gap-2"><Plus size={18} weight="bold" /><h2 className="text-sm font-black">创建评测批次</h2></div><p className="mt-2 text-xs text-[var(--color-muted)]">完整批次自动快照 60 个案例、两个 Prompt 和统一模型参数。</p>
              <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={createRun}>
                <label className="text-xs font-bold sm:col-span-2">批次名称<input className="control-base mt-2 min-h-11 w-full px-3" defaultValue={`Prompt 评测 ${new Date().toLocaleDateString('zh-CN')}`} name="runName" required /></label>
                <label className="text-xs font-bold">执行模式<select className="control-base mt-2 min-h-11 w-full px-3" name="executionMode"><option value="mock">Mock 流程演示</option><option value="live">Live 模型评测</option></select></label>
                <label className="text-xs font-bold">裁决员<select className="control-base mt-2 min-h-11 w-full px-3" name="adjudicatorId" required><option value="">请选择</option>{adjudicators.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                <label className="text-xs font-bold">Baseline Prompt<select className="control-base mt-2 min-h-11 w-full px-3" name="baselinePromptId" required>{initial.promptVersions.filter((item) => item.role === 'baseline').map((item) => <option key={item.id} value={item.id}>{item.version} · {item.name}</option>)}</select></label>
                <label className="text-xs font-bold">Candidate Prompt<select className="control-base mt-2 min-h-11 w-full px-3" name="candidatePromptId" required>{initial.promptVersions.filter((item) => item.role === 'candidate').map((item) => <option key={item.id} value={item.id}>{item.version} · {item.name}</option>)}</select></label>
                <label className="text-xs font-bold">评测员 A<select className="control-base mt-2 min-h-11 w-full px-3" name="evaluatorA" required><option value="">请选择</option>{evaluators.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                <label className="text-xs font-bold">评测员 B<select className="control-base mt-2 min-h-11 w-full px-3" name="evaluatorB" required><option value="">请选择</option>{evaluators.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
                <button className="button-primary sm:col-span-2" disabled={evaluators.length < 2 || adjudicators.length < 1} type="submit">创建并进入批次 <ArrowRight size={16} weight="bold" /></button>
              </form>
            </section>
            <section className="editorial-panel p-5"><div className="flex items-center gap-2"><UsersThree size={18} weight="bold" /><h2 className="text-sm font-black">添加内部账号</h2></div><p className="mt-2 text-xs text-[var(--color-muted)]">评测员互相不可见评分；裁决员不能兼任主要评测者。</p>
              <form className="mt-5 space-y-3" onSubmit={createUser}>
                <input className="control-base min-h-10 w-full px-3 text-sm" name="username" placeholder="用户名" required />
                <input className="control-base min-h-10 w-full px-3 text-sm" name="displayName" placeholder="显示名称" required />
                <input className="control-base min-h-10 w-full px-3 text-sm" minLength={12} name="password" placeholder="初始密码（至少 12 位）" required type="password" />
                <select className="control-base min-h-10 w-full px-3 text-sm" name="role"><option value="evaluator">评测员</option><option value="adjudicator">裁决员</option><option value="admin">管理员</option></select>
                <button className="button-secondary w-full" type="submit"><ShieldCheck size={16} />创建账号</button>
              </form>
              <div className="mt-5 space-y-2 border-t border-[var(--color-line)] pt-4">{initial.users.map((account) => <details className="control-base p-3" key={account.id}><summary className="cursor-pointer text-xs font-black">{account.displayName} · {account.role}<span className="ml-2 font-normal text-[var(--color-muted)]">{account.status}</span></summary><div className="mt-3 flex flex-wrap gap-2"><button className="button-secondary" disabled={account.id === initial.user.id} onClick={() => updateAccount(account.id, { status: account.status === 'active' ? 'disabled' : 'active' })} type="button">{account.status === 'active' ? '停用账号' : '恢复账号'}</button><form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); updateAccount(account.id, { password: String(form.get('password')) }); }}><input className="control-base min-w-0 flex-1 px-3 text-xs" minLength={12} name="password" placeholder="输入 12 位以上新密码" required type="password" /><button className="button-secondary" type="submit">重置密码</button></form></div></details>)}</div>
            </section>
          </div>
        )}

        <section className="editorial-panel mt-6 overflow-hidden"><div className="border-b border-[var(--color-line)] p-5"><h2 className="text-sm font-black">评测批次</h2><p className="mt-1 text-xs text-[var(--color-muted)]">Mock 批次永久显示“需要继续评测”，不会形成升级结论。</p></div>
          {initial.runs.length === 0 ? <div className="p-10 text-center text-sm text-[var(--color-muted)]">暂无批次。管理员先创建评测账号和第一个批次。</div> : <div className="divide-y divide-[var(--color-line)]">{initial.runs.map((run) => <Link className="grid gap-3 p-5 transition-colors hover:bg-[var(--color-surface-subtle)] sm:grid-cols-[1fr_auto] sm:items-center" href={`/evaluation/runs/${run.id}`} key={run.id}><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{run.runName}</h3><span className="rounded-full bg-[var(--color-surface-subtle)] px-2 py-1 text-[10px] font-black">{run.executionMode === 'mock' ? '模拟生成' : 'Live 模型'}</span><span className="text-[10px] font-bold text-[var(--color-muted)]">{run.status}</span></div><p className="mt-2 text-xs text-[var(--color-muted)]">生成 {run.generatedTasks}/{run.totalGenerationTasks} · 候选 {run.candidateCount}/360 · 正式结果 {run.selectedCount}/{run.caseCount * 2} · 原始评分 {run.primaryReviewCount}/{run.caseCount * 4}</p></div><ArrowRight size={18} weight="bold" /></Link>)}</div>}
        </section>

        {initial.user.role === "admin" && <div className="mt-6 grid gap-4 lg:grid-cols-2"><section className="editorial-panel p-5"><h2 className="text-sm font-black">固定案例</h2><p className="mt-2 text-xs text-[var(--color-muted)]">{initial.cases.length} 条 · {new Set(initial.cases.map((item) => item.topicId)).size} 个主题 · 输入在批次中不可修改</p><div className="mt-4 flex flex-wrap gap-2">{['小红书','抖音','B站'].map((label) => <span className="control-base px-3 py-2 text-xs font-bold" key={label}>{label} {initial.cases.filter((item) => item.platformLabel === label).length}</span>)}</div></section><section className="editorial-panel p-5"><h2 className="text-sm font-black">Prompt 版本</h2><div className="mt-4 space-y-3">{initial.promptVersions.map((prompt) => <details className="control-base p-3" key={prompt.id}><summary className="cursor-pointer text-xs font-black">{prompt.version} · {prompt.role}<span className="ml-2 font-normal text-[var(--color-muted)]">{prompt.changeSummary}</span></summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-graphite)]">{prompt.promptContent}</pre>{prompt.role === 'candidate' && <button className="button-secondary mt-3" onClick={() => setBaseline(prompt.id)} type="button">设为当前 baseline</button>}</details>)}</div><form className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-5" onSubmit={createPrompt}><p className="text-xs font-black">创建不可变 Candidate 版本</p><div className="grid grid-cols-2 gap-3"><input className="control-base min-h-10 px-3 text-sm" name="version" placeholder="v1.2" required /><input className="control-base min-h-10 px-3 text-sm" name="name" placeholder="版本名称" required /></div><input className="control-base min-h-10 w-full px-3 text-sm" name="changeSummary" placeholder="修改说明" required /><textarea className="control-base min-h-28 w-full p-3 text-sm" name="promptContent" placeholder="完整 Prompt 文本" required /><button className="button-secondary w-full" type="submit">创建新版本（不覆盖历史）</button></form></section></div>}
      </main>
    </div>
  );
}
