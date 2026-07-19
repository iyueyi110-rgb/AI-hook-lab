"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowClockwise,
  ArrowUp,
  Brain,
  Database,
  Plus,
  Stop,
  WarningCircle,
} from "@phosphor-icons/react";

import type { OpsAgentAnswer, OpsAgentMessage } from "@/lib/agent/ops-types";

const STORAGE_KEY = "ai-hook-lab:ops-agent-session";

interface SessionPointer { sessionId: string; revision: number }
interface TurnResponse extends SessionPointer { traceId: string; answer: OpsAgentAnswer; createdAt: string }

const quickPrompts = [
  "分析最近 7 天的真实用户生成健康度",
  "当前评测批次中最严重的 Bad Case 是什么",
  "对比 v1.0 和 v1.1 的同批次评测表现",
  "根据已有 Bad Case 提出待验证的 Prompt 优化建议",
];

function SourceStrip({ answer }: { answer: OpsAgentAnswer }) {
  if (!answer.sources.length) return null;
  return (
    <div className="grid border-b border-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
      {answer.sources.map((source, index) => (
        <div className="border-b border-[var(--color-line)] px-4 py-3 last:border-b-0 sm:border-r sm:last:border-r-0" key={source.id}>
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--color-accent)]">来源 {String(index + 1).padStart(2, "0")}</p>
          <p className="mt-1 text-xs font-bold text-[var(--color-ink)]">{source.label}</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-muted)]">
            {source.origin}{source.window ? ` · ${new Date(source.window.from).toLocaleDateString("zh-CN")}—${new Date(source.window.to).toLocaleDateString("zh-CN")}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function AnswerCard({ answer, timestamp }: { answer: OpsAgentAnswer; timestamp: string }) {
  const sourceNumber = new Map(answer.sources.map((source, index) => [source.id, index + 1]));
  const statusLabel = answer.status === "complete" ? "分析完成" : answer.status === "partial" ? "部分结果" : "需要确认";
  return (
    <article className="editorial-panel overflow-hidden" aria-label={`Agent 回答：${statusLabel}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent)] text-white"><Brain aria-hidden="true" size={16} weight="bold" /></span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--color-muted)]">{statusLabel}</p>
            <p className="mt-1 max-w-[72ch] text-sm font-bold leading-6 text-[var(--color-ink)]">{answer.summary}</p>
          </div>
        </div>
        <time className="text-[10px] text-[var(--color-muted)]">{new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      <SourceStrip answer={answer} />

      {answer.findings.length > 0 && (
        <section className="border-b border-[var(--color-line)] px-4 py-4 sm:px-5" aria-labelledby={`findings-${timestamp}`}>
          <h3 className="text-xs font-black" id={`findings-${timestamp}`}>核心发现</h3>
          <ol className="mt-3 space-y-3">
            {answer.findings.map((finding, index) => (
              <li className="grid gap-2 sm:grid-cols-[2rem_1fr]" key={`${finding.title}-${index}`}>
                <span className="text-2xl font-black tabular-nums text-[var(--color-line-strong)]">{String(index + 1).padStart(2, "0")}</span>
                <div><p className="text-sm font-bold">{finding.title}</p><p className="mt-1 text-xs leading-5 text-[var(--color-graphite)]">{finding.detail}</p>{finding.sourceIds.length > 0 && <p className="mt-1 text-[10px] font-bold text-[var(--color-accent)]">证据 {finding.sourceIds.map((id) => sourceNumber.get(id)).filter(Boolean).join("、")}</p>}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(answer.risks.length > 0 || answer.caveats.length > 0) && (
        <section className="grid border-b border-[var(--color-line)] md:grid-cols-2">
          {answer.risks.length > 0 && <div className="px-4 py-4 sm:px-5 md:border-r md:border-[var(--color-line)]"><h3 className="text-xs font-black text-[var(--color-danger)]">风险</h3><ul className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--color-graphite)]">{answer.risks.map((item) => <li key={item}>— {item}</li>)}</ul></div>}
          {answer.caveats.length > 0 && <div className="px-4 py-4 sm:px-5"><h3 className="text-xs font-black text-[var(--color-warning)]">数据局限</h3><ul className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--color-graphite)]">{answer.caveats.map((item) => <li key={item}>— {item}</li>)}</ul></div>}
        </section>
      )}

      {answer.recommendations.length > 0 && (
        <section className="px-4 py-4 sm:px-5">
          <h3 className="text-xs font-black">建议行动</h3>
          <div className="mt-3 space-y-3">
            {answer.recommendations.map((item, index) => <div className="grid gap-2 border-t border-[var(--color-line)] pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[3rem_1fr]" key={`${item.action}-${index}`}><span className="text-xs font-black text-[var(--color-accent)]">{item.priority}</span><div><p className="text-sm font-bold">{item.action}</p><p className="mt-1 text-xs leading-5 text-[var(--color-graphite)]">{item.rationale}</p>{item.sourceIds.length > 0 && <p className="mt-1 text-[10px] font-bold text-[var(--color-accent)]">证据 {item.sourceIds.map((id) => sourceNumber.get(id)).filter(Boolean).join("、")}</p>}</div></div>)}
          </div>
        </section>
      )}

      {answer.followUpQuestions.length > 0 && <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-subtle)] px-4 py-3 text-xs leading-5 sm:px-5"><p className="font-black">需要确认</p>{answer.followUpQuestions.map((item) => <p className="mt-1" key={item}>{item}</p>)}</div>}
    </article>
  );
}

export function OpsAgentChat() {
  const [pointer, setPointer] = useState<SessionPointer | null>(null);
  const [messages, setMessages] = useState<OpsAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [failedText, setFailedText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const finish = () => setRestoring(false);
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) { queueMicrotask(finish); return; }
    let saved: SessionPointer;
    try { saved = JSON.parse(raw) as SessionPointer; } catch { sessionStorage.removeItem(STORAGE_KEY); queueMicrotask(finish); return; }
    fetch(`/api/agent/ops?sessionId=${encodeURIComponent(saved.sessionId)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { sessionId: string; revision: number; messages: OpsAgentMessage[] };
      const next = { sessionId: data.sessionId, revision: data.revision };
      setPointer(next); setMessages(data.messages); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }).catch(() => sessionStorage.removeItem(STORAGE_KEY)).finally(finish);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value || loading) return;
    const optimistic: OpsAgentMessage = { id: `local-${Date.now()}`, role: "user", content: value, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]); setInput(""); setLoading(true); setError(""); setFailedText("");
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch("/api/agent/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: pointer?.sessionId, expectedRevision: pointer?.revision, message: value }), signal: controller.signal });
      const data = await response.json() as TurnResponse & { message?: string; error?: string };
      if (!response.ok) {
        if (data.sessionId && Number.isInteger(data.revision)) {
          const next = { sessionId: data.sessionId, revision: data.revision };
          setPointer(next); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        }
        throw new Error(data.message ?? data.error ?? "请求失败");
      }
      const next = { sessionId: data.sessionId, revision: data.revision };
      setPointer(next); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setMessages((current) => [...current, { id: data.traceId, role: "assistant", content: data.answer.summary, answer: data.answer, createdAt: data.createdAt }]);
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      if (caught instanceof Error && caught.name === "AbortError") {
        if (pointer?.sessionId) {
          void fetch(`/api/agent/ops?sessionId=${encodeURIComponent(pointer.sessionId)}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : undefined).then((data: { sessionId: string; revision: number } | undefined) => {
            if (!data) return;
            const next = { sessionId: data.sessionId, revision: data.revision };
            setPointer(next); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          }).catch(() => undefined);
        }
      } else { setError(caught instanceof Error ? caught.message : "请求失败"); setFailedText(value); }
    } finally { abortRef.current = null; setLoading(false); inputRef.current?.focus(); }
  }, [loading, pointer]);

  const newConversation = () => { abortRef.current?.abort(); sessionStorage.removeItem(STORAGE_KEY); setPointer(null); setMessages([]); setError(""); setFailedText(""); setInput(""); };
  const submit = (event: FormEvent) => { event.preventDefault(); void sendMessage(input); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } };

  return (
    <div className="grid min-h-[calc(100vh-220px)] gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="space-y-4" aria-live="polite">
          {!restoring && messages.length === 0 && (
            <section className="editorial-panel overflow-hidden">
              <div className="grid gap-5 px-5 py-6 sm:grid-cols-[1fr_auto] sm:items-end">
                <div><p className="text-xs font-black text-[var(--color-accent)]">只读分析</p><h2 className="mt-2 text-2xl font-black tracking-[-0.035em]">从问题开始，结论回到证据。</h2><p className="mt-3 max-w-[64ch] text-sm leading-6 text-[var(--color-graphite)]">Agent 会查询看板与离线评测数据。它不会修改 Prompt、发布版本或写入业务数据。</p></div>
                <Database aria-hidden="true" className="text-[var(--color-line-strong)]" size={56} weight="thin" />
              </div>
            </section>
          )}
          {messages.map((message) => message.role === "assistant" && message.answer ? <AnswerCard answer={message.answer} key={message.id} timestamp={message.createdAt} /> : <div className="ml-auto max-w-[80%] rounded-[10px] bg-[var(--color-ink)] px-4 py-3 text-sm leading-6 text-white" key={message.id}>{message.content}</div>)}
          {loading && <div className="editorial-panel flex items-center gap-3 px-4 py-4 text-sm text-[var(--color-muted)]"><span className="soft-pulse h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />正在查询并核对数据…</div>}
          {error && <div className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4 text-sm text-[var(--color-danger)]" role="alert"><div className="flex gap-2"><WarningCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} weight="fill" /><div><p className="font-bold">请求失败</p><p className="mt-1 text-xs">{error}</p></div></div>{failedText && <button className="button-secondary min-h-9" onClick={() => void sendMessage(failedText)} type="button"><ArrowClockwise aria-hidden="true" size={14} />重试</button>}</div>}
          <div ref={endRef} />
        </div>

        <form className="sticky bottom-0 mt-5 border-t border-[var(--color-line-strong)] bg-[color:rgb(245_245_243_/_0.96)] py-4 backdrop-blur-md" onSubmit={submit}>
          <div className="flex gap-2">
            <textarea aria-label="运营分析问题" className="control-base min-h-12 flex-1 resize-none px-4 py-3 text-sm leading-6" disabled={loading || restoring} maxLength={4000} onChange={(event) => setInput(event.target.value)} onKeyDown={keyDown} placeholder="输入分析问题；Enter 发送，Shift+Enter 换行" ref={inputRef} rows={1} value={input} />
            {loading ? <button aria-label="取消请求" className="button-secondary h-12 min-h-12 w-12 p-0" onClick={() => abortRef.current?.abort()} type="button"><Stop aria-hidden="true" size={18} weight="fill" /></button> : <button aria-label="发送消息" className="button-primary h-12 min-h-12 w-12 p-0" disabled={!input.trim() || restoring} type="submit"><ArrowUp aria-hidden="true" size={19} weight="bold" /></button>}
          </div>
        </form>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <button className="button-secondary w-full" disabled={restoring} onClick={newConversation} type="button"><Plus aria-hidden="true" size={15} weight="bold" />新建对话</button>
        {!restoring && messages.length === 0 && <section className="border-t border-[var(--color-line-strong)] pt-4"><h2 className="text-xs font-black">快捷问题</h2><div className="mt-3 space-y-2">{quickPrompts.map((prompt) => <button className="control-base w-full px-3 py-3 text-left text-xs font-bold leading-5" key={prompt} onClick={() => void sendMessage(prompt)} type="button">{prompt}</button>)}</div></section>}
        <section className="border-t border-[var(--color-line)] pt-4 text-[11px] leading-5 text-[var(--color-muted)]"><p className="font-bold text-[var(--color-ink)]">数据边界</p><p className="mt-1">模拟数据不会形成升级结论。Prompt 建议必须经过现有离线评测后再采用。</p></section>
      </aside>
    </div>
  );
}
