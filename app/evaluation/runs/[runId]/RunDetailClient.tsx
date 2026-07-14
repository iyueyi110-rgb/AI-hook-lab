"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Flask, Play, WarningCircle } from "@phosphor-icons/react";

import { AppHeader } from "@/components/AppHeader";
import type { EvaluationRunRecord, UserRole } from "@/lib/evaluation/types";

interface PublicUser { id: string; username: string; displayName: string; role: UserRole; status: string; }
interface BlindFormalResult { id: string; caseId: string; platform: string; blindLabel: "A" | "B"; content?: string; styleTag?: string; recommendReason?: string; overLength?: boolean; myReview?: { id: string }; reviews?: Array<{ favoriteIntent: boolean; adoptionIntent: boolean }>; adjudicatedFavoriteIntent?: boolean; adjudicatedAdoptionIntent?: boolean; }

export function RunDetailClient({ initialRun, user }: { initialRun: EvaluationRunRecord; user: PublicUser }) {
  const [run, setRun] = useState(initialRun);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function action(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    const response = await fetch(`/api/evaluation/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setError(result.error ?? "操作失败"); return null; }
    setRun(result.run);
    return result.run as EvaluationRunRecord;
  }

  async function loadReport() {
    const response = await fetch(`/api/evaluation/runs/${run.id}/report`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) return setError(result.error ?? "报告读取失败");
    setReport(result);
  }

  async function generateAll() {
    setBusy(true); setError("");
    let current = run;
    for (let index = 0; index < run.caseCount; index += 1) {
      const response = await fetch(`/api/evaluation/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate-next" }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "批量生成失败"); break; }
      current = result.run;
      setRun(current);
      const tasks = current.generationTasks ?? [];
      if (tasks.some((item) => item.terminalStatus === "format_error" || item.terminalStatus === "generation_error") || tasks.every((item) => item.terminalStatus === "success")) break;
    }
    setBusy(false);
  }

  const pendingSlot = useMemo(() => {
    if (user.role !== "admin") return null;
    return run.candidates.find((candidate) => !run.formalResults.some((formal) => formal.caseId === candidate.caseId && formal.promptRole === candidate.promptRole));
  }, [run, user.role]);
  const pendingCandidates = pendingSlot ? run.candidates.filter((item) => item.caseId === pendingSlot.caseId && item.promptRole === pendingSlot.promptRole) : [];

  const blindResults = run.formalResults as unknown as BlindFormalResult[];
  const pendingReview = user.role === "evaluator" ? blindResults.find((item) => !item.myReview) : undefined;
  const myPairwise = ((run as unknown as { myPairwise?: Array<{ caseId: string }> }).myPairwise ?? run.rawPairwiseEvaluations ?? []) as Array<{ caseId: string }>;
  const pendingPairCase = user.role === "evaluator" ? run.cases?.find((item) => !myPairwise.some((review) => review.caseId === item.caseId) && blindResults.filter((result) => result.caseId === item.caseId).length === 2) : undefined;
  const pairOptions = pendingPairCase ? blindResults.filter((item) => item.caseId === pendingPairCase.caseId).sort((a, b) => a.blindLabel.localeCompare(b.blindLabel)) : [];
  const intentConflict = user.role === "adjudicator" ? blindResults.find((item) => item.reviews?.length === 2 && ((item.reviews[0].favoriteIntent !== item.reviews[1].favoriteIntent && item.adjudicatedFavoriteIntent === undefined) || (item.reviews[0].adoptionIntent !== item.reviews[1].adoptionIntent && item.adjudicatedAdoptionIntent === undefined))) : undefined;
  const pairwiseConflict = user.role === "adjudicator" ? run.pairwiseDecisions?.find((item) => !item.winnerRole) : undefined;
  const adjudicationPairOptions = pairwiseConflict ? blindResults.filter((item) => item.caseId === pairwiseConflict.caseId).sort((a, b) => a.blindLabel.localeCompare(b.blindLabel)) : [];
  const pendingBadCase = user.role === "admin" ? run.badCases?.find((item) => !item.rootCause || !item.improvementAction) : undefined;

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingReview) return;
    const form = new FormData(event.currentTarget);
    const badType = String(form.get("badCaseType") ?? "");
    await action({ action: "submit-review", formalResultId: pendingReview.id, review: {
      usabilityScore: Number(form.get("usabilityScore")), platformFitScore: Number(form.get("platformFitScore")),
      attractivenessScore: Number(form.get("attractivenessScore")), reasonQualityScore: Number(form.get("reasonQualityScore")),
      favoriteIntent: form.get("favoriteIntent") === "true", adoptionIntent: form.get("adoptionIntent") === "true",
      evaluatorNote: form.get("evaluatorNote"), badCases: badType ? [{ type: badType, severity: form.get("severity"), description: form.get("badCaseDescription") }] : [],
    }});
  }

  async function submitPairwise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingPairCase) return;
    const form = new FormData(event.currentTarget);
    await action({ action: "submit-pairwise", caseId: pendingPairCase.caseId, winner: form.get("winner"), comparisonReason: form.get("comparisonReason") });
  }

  async function submitAdjudication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action({ action: "adjudicate", adjudication: {
      caseId: String(form.get("caseId")), formalResultId: form.get("formalResultId") || undefined,
      favoriteIntent: form.has("favoriteIntent") ? form.get("favoriteIntent") === "true" : undefined,
      adoptionIntent: form.has("adoptionIntent") ? form.get("adoptionIntent") === "true" : undefined,
      pairwiseWinnerLabel: form.get("pairwiseWinnerLabel") || undefined, reason: form.get("reason"),
    }});
  }

  async function reviewBadCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingBadCase) return;
    const form = new FormData(event.currentTarget);
    await action({ action: "review-bad-case", badCaseId: pendingBadCase.id, rootCause: form.get("rootCause"), improvementAction: form.get("improvementAction") });
  }

  const generated = run.generationTasks?.filter((item) => item.terminalStatus === "success").length ?? Number((run as unknown as { generatedTasks?: number }).generatedTasks ?? 0);
  const totalTasks = run.generationTasks?.length ?? Number((run as unknown as { totalGenerationTasks?: number }).totalGenerationTasks ?? run.caseCount * 2);

  return (
    <div className="min-h-screen"><AppHeader /><main className="mx-auto w-full max-w-7xl px-4 py-7 pb-20 md:px-6">
      <Link className="inline-flex items-center gap-2 text-xs font-bold text-[var(--color-muted)] hover:text-[var(--color-ink)]" href="/evaluation"><ArrowLeft size={15} />返回评测概览</Link>
      <header className="mt-5 flex flex-col gap-4 border-b border-[var(--color-line-strong)] pb-6 md:flex-row md:items-end md:justify-between"><div><p className="flex items-center gap-2 text-xs font-black text-[var(--color-accent)]"><Flask size={15} weight="bold" />{run.dataOrigin} · {run.executionMode === 'mock' ? '模拟生成' : 'Live 模型'}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">{run.runName}</h1><p className="mt-2 text-xs text-[var(--color-muted)]">状态 {run.status} · {run.caseCount} 个固定案例 · 当前身份 {user.displayName}（{user.role}）</p></div>{user.role === 'admin' && <button className="button-secondary" onClick={loadReport} type="button">查看升级报告</button>}</header>

      <section className="mt-6 grid overflow-hidden rounded-[14px] border border-[var(--color-ink)] bg-white sm:grid-cols-4">{[
        ['生成任务',`${generated}/${totalTasks}`],['候选结果',`${run.candidates?.length ?? Number((run as unknown as { candidateCount?: number }).candidateCount ?? 0)}/${run.caseCount * 6}`],['正式结果',`${run.formalResults?.length ?? Number((run as unknown as { selectedCount?: number }).selectedCount ?? 0)}/${run.caseCount * 2}`],['A/B 定案',`${run.pairwiseDecisions?.filter((item) => item.winnerRole).length ?? 0}/${run.caseCount}`]
      ].map(([label,value]) => <div className="border-b border-[var(--color-line)] p-4 last:border-0 sm:border-b-0 sm:border-r" key={label}><p className="text-[11px] font-bold text-[var(--color-muted)]">{label}</p><p className="mt-2 text-2xl font-black tabular-nums">{value}</p></div>)}</section>

      {run.executionMode === 'mock' && <div className="mt-5 flex gap-3 rounded-[10px] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-4 text-xs leading-5 text-[var(--color-warning)]"><WarningCircle className="mt-0.5 shrink-0" size={17} weight="fill" /><p><strong>模拟数据：</strong>此批次可以演示完整流程，但升级结论永久为“需要继续评测”，不会进入真实行为统计。</p></div>}
      {error && <p className="mt-5 rounded-[10px] bg-[var(--color-danger-soft)] p-4 text-sm font-bold text-[var(--color-danger)]" role="alert">{error}</p>}

      {user.role === 'admin' && <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="editorial-panel p-5"><h2 className="text-sm font-black">1. 批量生成</h2><p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">每次处理一个案例的 baseline/candidate，共产生 6 条候选；失败状态保留原始证据。</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="button-secondary" disabled={busy || generated >= totalTasks || run.generationTasks?.some((item) => item.terminalStatus === 'format_error' || item.terminalStatus === 'generation_error')} onClick={() => action({ action: 'generate-next' })} type="button">生成下一案例</button><button className="button-primary" disabled={busy || generated >= totalTasks || run.generationTasks?.some((item) => item.terminalStatus === 'format_error' || item.terminalStatus === 'generation_error')} onClick={generateAll} type="button"><Play size={16} weight="fill" />{busy ? '批量处理中' : generated >= totalTasks ? '生成已完成' : '连续生成全部'}</button></div>{run.generationTasks?.filter((item) => item.terminalStatus === 'format_error' || item.terminalStatus === 'generation_error').map((task) => <div className="mt-3 rounded-[8px] bg-[var(--color-danger-soft)] p-3 text-xs" key={task.id}><p className="font-bold text-[var(--color-danger)]">{task.caseId} · {task.promptRole} · {task.terminalStatus}</p><p className="mt-1 text-[var(--color-muted)]">{task.lastError}</p><button className="button-secondary mt-2" onClick={() => action({ action: 'retry-generation', taskId: task.id })} type="button">重新排队</button></div>)}</section>
        <section className="editorial-panel p-5"><h2 className="text-sm font-black">2. 选择正式结果</h2>{pendingCandidates.length === 0 ? <p className="mt-5 text-xs text-[var(--color-muted)]">生成候选后，这里会显示下一组待筛选结果。</p> : <div className="mt-4 space-y-3"><p className="text-xs font-bold">{pendingSlot?.caseId} · {pendingSlot?.promptRole}</p>{pendingCandidates.map((candidate) => <article className="control-base p-3" key={candidate.id}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{candidate.content}</p><p className="mt-2 text-[11px] text-[var(--color-muted)]">{candidate.styleTag} · {candidate.overLength ? '字数超限' : '字数合规'} · 模型自评分 {candidate.modelScore ?? '未提供'}</p><p className="mt-2 text-xs leading-5 text-[var(--color-graphite)]">{candidate.recommendReason}</p></div><button className="button-secondary shrink-0" disabled={busy} onClick={() => action({ action: 'select-candidate', candidateId: candidate.id })} type="button"><Check size={15} />选用</button></div></article>)}</div>}</section>
      </div>}

      {user.role === 'evaluator' && <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="editorial-panel p-5"><h2 className="text-sm font-black">单条匿名评分</h2>{!pendingReview ? <p className="mt-5 text-xs text-[var(--color-muted)]">暂无待评分正式结果。</p> : <form className="mt-4 space-y-4" onSubmit={submitReview}><div className="rounded-[10px] bg-[var(--color-surface-subtle)] p-4"><p className="text-[10px] font-black text-[var(--color-accent)]">方案 {pendingReview.blindLabel} · {pendingReview.caseId}</p><p className="mt-2 text-base font-black leading-7">{pendingReview.content}</p><p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">{pendingReview.recommendReason}</p></div><div className="grid grid-cols-2 gap-3">{[['usabilityScore','人工可用性'],['platformFitScore','平台适配度'],['attractivenessScore','开头吸引力'],['reasonQualityScore','推荐理由质量']].map(([name,label]) => <label className="text-xs font-bold" key={name}>{label}<select className="control-base mt-2 min-h-10 w-full px-3" defaultValue="4" name={name}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} 分</option>)}</select></label>)}</div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">人工收藏意向<select className="control-base mt-2 min-h-10 w-full px-3" name="favoriteIntent"><option value="false">否</option><option value="true">是</option></select></label><label className="text-xs font-bold">人工采用意向<select className="control-base mt-2 min-h-10 w-full px-3" name="adoptionIntent"><option value="false">否</option><option value="true">是</option></select></label></div><p className="text-[11px] leading-5 text-[var(--color-warning)]">收藏/采用意向不是用户真实收藏或内容发布行为。</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Bad Case（可选）<select className="control-base mt-2 min-h-10 w-full px-3" name="badCaseType"><option value="">无</option><option value="too_broad">内容过于宽泛</option><option value="platform_tone_mismatch">平台语气不匹配</option><option value="off_topic">与主题偏离</option><option value="formulaic_expression">表达套路化</option><option value="weak_opening">开头缺乏吸引力</option><option value="vague_reason">推荐理由空泛</option><option value="over_length">字数超限</option><option value="duplicate_candidates">候选内容重复</option><option value="factual_risk">存在事实风险</option><option value="unnatural_expression">表达不自然</option><option value="format_error">输出格式错误</option><option value="other">其他</option></select></label><label className="text-xs font-bold">严重度<select className="control-base mt-2 min-h-10 w-full px-3" name="severity"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div><textarea className="control-base min-h-20 w-full p-3 text-sm" name="evaluatorNote" placeholder="评测备注" /><button className="button-primary w-full" disabled={busy} type="submit">保存评分</button></form>}</section>
        <section className="editorial-panel p-5"><h2 className="text-sm font-black">A/B 成对盲评</h2>{!pendingPairCase || pairOptions.length < 2 ? <p className="mt-5 text-xs text-[var(--color-muted)]">同一案例的两条正式结果准备好后，这里会显示盲评任务。</p> : <form className="mt-4 space-y-4" onSubmit={submitPairwise}><p className="text-xs font-bold">{pendingPairCase.caseId} · {pendingPairCase.topic}</p>{pairOptions.map((option) => <article className="control-base p-4" key={option.id}><p className="text-[10px] font-black text-[var(--color-accent)]">方案 {option.blindLabel}</p><p className="mt-2 text-sm font-black leading-6">{option.content}</p></article>)}<select className="control-base min-h-11 w-full px-3" name="winner"><option value="A">A 更好</option><option value="B">B 更好</option><option value="tie">两者相近</option></select><textarea className="control-base min-h-20 w-full p-3 text-sm" name="comparisonReason" placeholder="比较原因" /><button className="button-primary w-full" disabled={busy} type="submit">保存盲评</button></form>}</section>
      </div>}

      {user.role === 'adjudicator' && <section className="editorial-panel mt-6 p-5"><h2 className="text-sm font-black">分歧裁决</h2><p className="mt-3 text-xs leading-5 text-[var(--color-muted)]">裁决页只显示匿名方案和两名评测者的分歧，不显示 Prompt 版本映射。</p>{intentConflict ? <form className="mt-5 space-y-4" onSubmit={submitAdjudication}><input name="caseId" type="hidden" value={intentConflict.caseId} /><input name="formalResultId" type="hidden" value={intentConflict.id} /><div className="rounded-[10px] bg-[var(--color-surface-subtle)] p-4"><p className="text-[10px] font-black text-[var(--color-accent)]">方案 {intentConflict.blindLabel} · {intentConflict.caseId}</p><p className="mt-2 text-sm font-black">{intentConflict.content}</p></div>{intentConflict.reviews?.[0].favoriteIntent !== intentConflict.reviews?.[1].favoriteIntent && <label className="block text-xs font-bold">最终人工收藏意向<select className="control-base mt-2 min-h-10 w-full px-3" name="favoriteIntent"><option value="false">否</option><option value="true">是</option></select></label>}{intentConflict.reviews?.[0].adoptionIntent !== intentConflict.reviews?.[1].adoptionIntent && <label className="block text-xs font-bold">最终人工采用意向<select className="control-base mt-2 min-h-10 w-full px-3" name="adoptionIntent"><option value="false">否</option><option value="true">是</option></select></label>}<textarea className="control-base min-h-20 w-full p-3 text-sm" name="reason" placeholder="裁决原因（必填）" required /><button className="button-primary" type="submit">保存意向裁决</button></form> : pairwiseConflict && adjudicationPairOptions.length === 2 ? <form className="mt-5 space-y-4" onSubmit={submitAdjudication}><input name="caseId" type="hidden" value={pairwiseConflict.caseId} />{adjudicationPairOptions.map((option) => <article className="control-base p-4" key={option.id}><p className="text-[10px] font-black text-[var(--color-accent)]">方案 {option.blindLabel}</p><p className="mt-2 text-sm font-black">{option.content}</p></article>)}<select className="control-base min-h-10 w-full px-3" name="pairwiseWinnerLabel"><option value="A">A 更好</option><option value="B">B 更好</option><option value="tie">两者相近</option></select><textarea className="control-base min-h-20 w-full p-3 text-sm" name="reason" placeholder="裁决原因（必填）" required /><button className="button-primary" type="submit">保存 A/B 裁决</button></form> : <p className="mt-5 rounded-[8px] bg-[var(--color-surface-subtle)] p-4 text-xs">当前没有待裁决分歧。</p>}</section>}

      {user.role === 'admin' && <section className="editorial-panel mt-6 p-5"><h2 className="text-sm font-black">Bad Case 复盘</h2>{pendingBadCase ? <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={reviewBadCase}><div className="sm:col-span-2 rounded-[8px] bg-[var(--color-surface-subtle)] p-3 text-xs"><strong>{pendingBadCase.type}</strong> · {pendingBadCase.severity} · {pendingBadCase.description || '无描述'}</div><textarea className="control-base min-h-24 p-3 text-sm" name="rootCause" placeholder="根因" required /><textarea className="control-base min-h-24 p-3 text-sm" name="improvementAction" placeholder="改进动作" required /><button className="button-secondary sm:col-span-2" type="submit">保存复盘</button></form> : <p className="mt-4 text-xs text-[var(--color-muted)]">暂无待复盘 Bad Case。</p>}</section>}

      {report && <section className="editorial-panel mt-6 overflow-hidden"><div className="border-b border-[var(--color-line)] p-5"><h2 className="text-sm font-black">Prompt 升级报告</h2><p className="mt-2 text-xs text-[var(--color-muted)]">结论仅基于固定离线评测集，不代表真实点击或传播效果。</p><div className="mt-4 flex flex-wrap gap-2">{['evaluation_cases.csv','evaluation_generations.csv','human_evaluations.csv','pairwise_evaluations.csv','bad_cases.csv','evaluation_report.json','evaluation_report.md'].map((file) => <a className="button-secondary" href={`/api/evaluation/runs/${run.id}/export?file=${file}`} key={file}>{file}</a>)}</div></div><pre className="max-h-[620px] overflow-auto p-5 text-xs leading-6">{JSON.stringify(report, null, 2)}</pre></section>}
    </main></div>
  );
}
