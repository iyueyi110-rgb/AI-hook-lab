"use client";

import * as React from "react";
import {
  ArrowClockwise,
  CheckCircle,
  ChatCircleDots,
  ListChecks,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useCreativeCoach } from "@/hooks/useCreativeCoach";
import type { AnalyticsEventType } from "@/hooks/useAnalytics";
import { candidatesToHooks } from "@/lib/creativeWorkbench";
import type {
  AgentCommand,
  AgentRunStatus,
  Candidate,
  CreativeBrief,
} from "@/lib/agent/types";
import {
  createStrategyPresentationId,
  fetchActiveStrategies,
} from "@/lib/strategy/client";
import type { ActiveStrategyView } from "@/lib/strategy/service";
import type {
  StrategyFit,
  StrategyNotApplicableReason,
} from "@/lib/strategy/types";
import type { GenerateResponse, HookResult } from "@/lib/types";

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  understanding: "正在梳理需求",
  analyzing_image: "正在分析图片",
  awaiting_brief_confirmation: "等待确认简报",
  generating: "正在生成候选",
  reviewing: "正在比较候选",
  revising: "正在改写候选",
  awaiting_final_confirmation: "等待最终确认",
  completed: "本轮已完成",
  failed: "需要重试",
  cancelled: "本轮已取消",
};

const MEMORY_LABELS: Record<string, string> = {
  default_platform: "默认平台",
  preferred_style: "偏好风格",
  avoided_style: "避免风格",
  preferred_tone: "偏好情绪",
  word_limit_band: "字数区间",
  avoid_badcase_tag: "避免问题",
};

function allowed(commands: AgentCommand["type"][], command: AgentCommand["type"]): boolean {
  return commands.includes(command);
}

function isTerminal(status?: AgentRunStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export interface CreativeCoachWorkspaceState {
  status?: AgentRunStatus;
  allowedCommands: AgentCommand["type"][];
  needsInput: boolean;
  selectedCandidateId?: string;
  recommendedIds: string[];
  comparisonExplanations: string[];
  hasCandidates: boolean;
}

export interface CreativeCoachWorkspaceHandle {
  startClarification: (brief: Partial<CreativeBrief>) => Promise<void>;
  startPolishing: (brief: Partial<CreativeBrief>, seedCandidates: Candidate[]) => Promise<void>;
  rewriteCandidate: (candidateId: string, instruction?: string) => Promise<void>;
  selectCandidate: (candidateId: string) => Promise<void>;
  rejectBatch: (reason?: string) => Promise<void>;
}

interface CreativeCoachWorkspaceProps {
  open: boolean;
  currentBrief: Partial<CreativeBrief>;
  onOpenChange: (open: boolean) => void;
  onCandidatesChange: (hooks: HookResult[]) => void;
  onStateChange: (state: CreativeCoachWorkspaceState | null) => void;
  onFinalized: (response: GenerateResponse) => void;
  track: (type: AnalyticsEventType, payload?: Record<string, unknown>) => void;
}

export const CreativeCoachWorkspace = React.forwardRef<
  CreativeCoachWorkspaceHandle,
  CreativeCoachWorkspaceProps
>(function CreativeCoachWorkspace({
  open,
  currentBrief,
  onOpenChange,
  onCandidatesChange,
  onStateChange,
  onFinalized,
  track,
}, ref) {
  const coach = useCreativeCoach({ onFinalized, track });
  const [message, setMessage] = React.useState("");
  const [pendingSeeded, setPendingSeeded] = React.useState<{
    brief: Partial<CreativeBrief>;
    seedCandidates: Candidate[];
  } | null>(null);
  const [strategies, setStrategies] = React.useState<ActiveStrategyView[]>([]);
  const [strategyChoice, setStrategyChoice] = React.useState<string | "ignore" | null>(null);
  const [strategyLoading, setStrategyLoading] = React.useState(false);
  const [strategyError, setStrategyError] = React.useState("");
  const [strategyRefresh, setStrategyRefresh] = React.useState(0);
  const [strategyPresentationId, setStrategyPresentationId] = React.useState("");
  const [feedbackFit, setFeedbackFit] = React.useState<StrategyFit | "">("");
  const [feedbackReason, setFeedbackReason] = React.useState<StrategyNotApplicableReason | "">("");
  const [feedbackSent, setFeedbackSent] = React.useState(false);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);

  const current = coach.response;
  const run = current?.run;
  const allowedCommands = current?.allowedCommands ?? [];
  const needsInput = Boolean(current?.needsInput);
  const candidateHooks = React.useMemo(
    () => candidatesToHooks(current?.candidates ?? []),
    [current?.candidates],
  );
  const recommendedIds = React.useMemo(
    () => current?.topCandidates.map((candidate) => candidate.id) ?? [],
    [current?.topCandidates],
  );
  const state = React.useMemo<CreativeCoachWorkspaceState | null>(() => {
    if (!current) return null;
    return {
      status: current.run.status,
      allowedCommands: current.allowedCommands,
      needsInput: current.needsInput,
      selectedCandidateId: current.run.selectedCandidateId,
      recommendedIds,
      comparisonExplanations: current.comparisonExplanations,
      hasCandidates: current.candidates.length > 0,
    };
  }, [current, recommendedIds]);

  React.useEffect(() => {
    onStateChange(state);
  }, [onStateChange, state]);

  React.useEffect(() => {
    if (candidateHooks.length > 0) onCandidatesChange(candidateHooks);
  }, [candidateHooks, onCandidatesChange]);

  React.useImperativeHandle(ref, () => ({
    async startClarification(brief) {
      coach.skipRestore();
      setPendingSeeded(null);
      await coach.createRun({ brief });
    },
    async startPolishing(brief, seedCandidates) {
      coach.skipRestore();
      setPendingSeeded({ brief, seedCandidates });
      setStrategyChoice(null);
    },
    async rewriteCandidate(candidateId, instruction) {
      await coach.submitCommand({
        type: "rewrite_candidate",
        candidateId,
        ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
      });
    },
    async selectCandidate(candidateId) {
      await coach.submitCommand({ type: "select_candidate", candidateId });
    },
    async rejectBatch(reason) {
      await coach.submitCommand({
        type: "reject_batch",
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
    },
  }), [coach]);

  const strategyBrief = pendingSeeded?.brief ?? (
    current?.pendingConfirmation === "brief" ? currentBrief : undefined
  );
  const strategyPlatform = strategyBrief?.platform;
  const strategyContentType = strategyBrief?.contentType;

  React.useEffect(() => {
    if (!open || !strategyPlatform || !strategyContentType) return;
    const controller = new AbortController();
    const presentationId = createStrategyPresentationId();
    setStrategyLoading(true);
    setStrategyError("");
    setStrategyChoice(null);
    void fetchActiveStrategies(strategyPlatform, strategyContentType, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setStrategies(items);
        setStrategyPresentationId(presentationId);
        if (items.length === 0) setStrategyChoice("ignore");
        items.forEach((strategy) => track("agent_strategy_event", {
          action: "shown",
          presentationId,
          strategyCardId: strategy.id,
          strategyCardVersion: strategy.version,
          platform: strategyPlatform,
          contentType: strategyContentType,
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStrategies([]);
        setStrategyChoice("ignore");
        setStrategyError(error instanceof Error ? error.message : "无法读取策略卡");
      })
      .finally(() => {
        if (!controller.signal.aborted) setStrategyLoading(false);
      });
    return () => controller.abort();
  }, [
    open,
    strategyContentType,
    strategyPlatform,
    strategyRefresh,
    track,
  ]);

  React.useEffect(() => {
    if (
      coach.error?.status === 409 &&
      ["strategy_not_active", "strategy_expired", "strategy_scope_mismatch"].includes(
        coach.error.code ?? "",
      )
    ) {
      setStrategyRefresh((value) => value + 1);
    }
  }, [coach.error?.code, coach.error?.status]);

  const selectedStrategy = React.useMemo(() => {
    if (!strategyChoice || strategyChoice === "ignore") return undefined;
    return strategies.find((strategy) => `${strategy.id}:${strategy.version}` === strategyChoice);
  }, [strategies, strategyChoice]);

  const strategyRef = React.useMemo(
    () => selectedStrategy
      ? { id: selectedStrategy.id, version: selectedStrategy.version }
      : undefined,
    [selectedStrategy],
  );

  const trackStrategyDecision = React.useCallback((
    action: "selected" | "ignored",
    taskId: string,
    brief: Partial<CreativeBrief>,
  ) => {
    if (!brief.platform || !brief.contentType) return;
    const reference = selectedStrategy ?? strategies[0];
    if (!reference) return;
    track("agent_strategy_event", {
      action,
      presentationId: strategyPresentationId || taskId,
      strategyCardId: reference.id,
      strategyCardVersion: reference.version,
      taskId,
      platform: brief.platform,
      contentType: brief.contentType,
    });
  }, [selectedStrategy, strategies, strategyPresentationId, track]);

  const beginSeededRun = React.useCallback(async () => {
    if (!pendingSeeded || !strategyChoice) return;
    const next = await coach.createRun({
      brief: pendingSeeded.brief,
      seedCandidates: pendingSeeded.seedCandidates,
      ...(strategyRef ? { strategyRef } : {}),
    });
    if (!next) return;
    trackStrategyDecision(strategyRef ? "selected" : "ignored", next.run.id, pendingSeeded.brief);
    setPendingSeeded(null);
  }, [coach, pendingSeeded, strategyChoice, strategyRef, trackStrategyDecision]);

  const confirmBrief = React.useCallback(async () => {
    if (!strategyChoice) return;
    const next = await coach.submitCommand({
      type: "confirm_brief",
      briefPatch: currentBrief,
      ...(strategyRef ? { strategyRef } : { strategyRef: null }),
    });
    if (!next) return;
    trackStrategyDecision(strategyRef ? "selected" : "ignored", next.run.id, currentBrief);
  }, [coach, currentBrief, strategyChoice, strategyRef, trackStrategyDecision]);

  const submitStrategyFeedback = React.useCallback(async () => {
    if (!run?.strategyApplication || !run.brief || !feedbackFit) return;
    if (feedbackFit === "not_applicable" && !feedbackReason) return;
    const saved = await coach.recordStrategyFeedback(
      feedbackFit,
      feedbackFit === "not_applicable" ? feedbackReason || undefined : undefined,
    );
    if (!saved) return;
    track("agent_strategy_event", {
      action: "feedback",
      presentationId: strategyPresentationId || run.id,
      strategyCardId: run.strategyApplication.id,
      strategyCardVersion: run.strategyApplication.version,
      taskId: run.id,
      platform: run.brief.platform,
      contentType: run.brief.contentType,
      strategyFit: feedbackFit,
      ...(feedbackFit === "not_applicable" ? { notApplicableReason: feedbackReason } : {}),
    });
    setFeedbackSent(true);
  }, [
    coach,
    feedbackFit,
    feedbackReason,
    run,
    strategyPresentationId,
    track,
  ]);

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      queueMicrotask(() => closeButtonRef.current?.focus());
    }
    if (!open && wasOpenRef.current) {
      const returnTarget = previousFocusRef.current;
      queueMicrotask(() => returnTarget?.focus());
    }
    wasOpenRef.current = open;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => window.removeEventListener("keydown", handleDialogKey);
  }, [close, open]);

  const submitMessage = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || !allowed(allowedCommands, "message")) return;
    setMessage("");
    void coach.submitCommand({ type: "message", text });
  };

  const selectedCandidate = current?.candidates.find(
    (candidate) => candidate.id === run?.selectedCandidateId,
  );
  const strategySelector = strategyBrief ? (
    <section className="rounded-[10px] border border-[var(--color-line)] p-3">
      <p className="text-xs font-extrabold">可选运营策略</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--color-muted)]">
        仅展示已通过离线评测并由管理员激活、且与当前平台和内容类型精确匹配的策略。每轮最多使用一张。
      </p>
      {strategyLoading && (
        <p className="mt-3 text-xs font-bold text-[var(--color-accent)]">正在检查可用策略…</p>
      )}
      {strategyError && (
        <p className="mt-3 rounded-[8px] bg-[var(--color-warning-soft)] p-2 text-xs text-[var(--color-warning)]">
          {strategyError}。本轮仍可明确忽略策略继续。
        </p>
      )}
      {!strategyLoading && strategies.length > 0 && (
        <div className="mt-3 space-y-2">
          {strategies.map((strategy) => {
            const value = `${strategy.id}:${strategy.version}`;
            return (
              <label
                className={`block cursor-pointer rounded-[8px] border p-3 ${
                  strategyChoice === value
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-line)]"
                }`}
                key={value}
              >
                <span className="flex items-start gap-2">
                  <input
                    checked={strategyChoice === value}
                    className="mt-0.5"
                    name="strategy-card"
                    onChange={() => setStrategyChoice(value)}
                    type="radio"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-black">{strategy.title} · v{strategy.version}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-[var(--color-graphite)]">
                      {strategy.guidance.do.slice(0, 2).join("；")}
                      {strategy.guidance.avoid.length > 0
                        ? `；避免：${strategy.guidance.avoid.join("；")}`
                        : ""}
                    </span>
                    <span className="mt-2 block text-[10px] leading-4 text-[var(--color-muted)]">
                      策略建议受众：{strategy.audienceLabel || "未指定"}<br />
                      当前任务受众：{strategyBrief.targetAudience || "未填写"}<br />
                      受众未自动匹配，请自行核对
                      <br />
                      证据更新：{new Date(strategy.evidenceUpdatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {!strategyLoading && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-[8px] border border-[var(--color-line)] p-3">
          <input
            checked={strategyChoice === "ignore"}
            className="mt-0.5"
            name="strategy-card"
            onChange={() => setStrategyChoice("ignore")}
            type="radio"
          />
          <span>
            <span className="block text-xs font-black">本轮忽略策略</span>
            <span className="mt-1 block text-[10px] text-[var(--color-muted)]">
              不影响创作 Agent 的原有确认、改写和最终确认流程。
            </span>
          </span>
        </label>
      )}
    </section>
  ) : null;

  return open ? (
    <>
      <button
        aria-label="关闭创作 Agent 遮罩"
        className="fixed inset-0 z-40 bg-black/25"
        onClick={close}
        type="button"
      />
      <aside
        aria-labelledby="creative-coach-title"
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-panel)]"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]">
              <ChatCircleDots aria-hidden="true" size={16} weight="bold" />
              创作 Agent
            </p>
            <h2 className="mt-1 text-base font-black" id="creative-coach-title">
              {run ? STATUS_LABELS[run.status] : "按需协助本轮创作"}
            </h2>
          </div>
          <button
            aria-label="关闭创作 Agent 面板"
            className="button-secondary !min-h-8 !p-1.5"
            onClick={close}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {coach.restoring && !run && (
            <p className="soft-pulse rounded-[10px] bg-[var(--color-surface-subtle)] p-3 text-xs font-bold">
              正在恢复上次任务…
            </p>
          )}

          {!run && !coach.restoring && coach.error && (
            <section className="rounded-[10px] border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-4" role="alert">
              <p className="text-xs font-extrabold text-[var(--color-danger)]">恢复未完成</p>
              <h3 className="mt-2 text-lg font-black">{coach.error.title}</h3>
              <p className="mt-2 text-xs leading-5 text-[var(--color-graphite)]">{coach.error.message}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="button-primary" onClick={() => void coach.retryRestore()} type="button">
                  <ArrowClockwise aria-hidden="true" size={16} weight="bold" />
                  重试恢复
                </button>
                <button className="button-secondary" onClick={coach.skipRestore} type="button">
                  跳过恢复并开始新任务
                </button>
              </div>
            </section>
          )}

          {!run && !coach.restoring && !coach.error && (
            <p className="rounded-[10px] bg-[var(--color-surface-subtle)] p-3 text-xs leading-5 text-[var(--color-graphite)]">
              我会沿用左侧创作简报。你可以让我补齐模糊需求，或把当前候选带进来继续比较和改写。
            </p>
          )}

          {!run && pendingSeeded && (
            <>
              {strategySelector}
              <button
                className="button-primary w-full"
                disabled={coach.loading || strategyLoading || !strategyChoice}
                onClick={() => void beginSeededRun()}
                type="button"
              >
                <CheckCircle aria-hidden="true" size={16} weight="bold" />
                带入当前候选并继续打磨
              </button>
            </>
          )}

          {run?.messages
            .filter((item) => item.role !== "tool")
            .map((item) => (
              <div
                className={`max-w-[92%] rounded-[10px] px-3 py-2 text-xs leading-5 ${
                  item.role === "user"
                    ? "ml-auto bg-[var(--color-ink)] text-white"
                    : "bg-[var(--color-surface-subtle)]"
                }`}
                key={item.id}
              >
                {item.content}
              </div>
            ))}

          {run?.toolCalls.slice(-4).map((call) => (
            <p className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]" key={call.id}>
              <ListChecks aria-hidden="true" size={14} />
              {call.tool === "compare_candidates"
                ? "候选比较"
                : call.tool === "save_final_choice"
                  ? "保存最终选择"
                  : call.tool === "rewrite_hook"
                    ? "改写候选"
                    : "生成候选"}
              ：{call.status === "completed" ? "已完成" : "进行中"}
            </p>
          ))}

          {run?.status === "understanding" && run.requiresFormCompletion && (
            <button
              className="button-primary w-full"
              disabled={coach.loading || !currentBrief.topic || !allowed(allowedCommands, "message")}
              onClick={() => void coach.submitCommand({ type: "message", text: JSON.stringify(currentBrief) })}
              type="button"
            >
              <ListChecks aria-hidden="true" size={16} weight="bold" />
              用当前表单补全简报
            </button>
          )}

          {current?.pendingConfirmation === "brief" && (
            <section className="rounded-[10px] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-4">
              <p className="text-xs font-extrabold text-[var(--color-accent)]">简报已就绪</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-graphite)]">
                确认后会按当前主题、平台和内容类型生成 10 条候选。
              </p>
              <div className="mt-3">{strategySelector}</div>
              <button
                className="button-primary mt-3 w-full"
                disabled={coach.loading || strategyLoading || !strategyChoice || !needsInput || !allowed(allowedCommands, "confirm_brief")}
                onClick={() => void confirmBrief()}
                type="button"
              >
                <CheckCircle aria-hidden="true" size={16} weight="bold" />
                确认简报并生成
              </button>
            </section>
          )}

          {candidateHooks.length > 0 && run?.status !== "awaiting_final_confirmation" && (
            <section className="rounded-[10px] border border-[var(--color-line)] p-3">
              <p className="text-xs font-extrabold">候选已同步到结果区</p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--color-muted)]">
                可直接在候选卡上改写或选择。这里保留状态、问题和操作记录。
              </p>
              {recommendedIds.length > 0 && (
                <p className="mt-2 text-[11px] font-bold text-[var(--color-accent)]">
                  已标出 Agent 推荐的 Top {recommendedIds.length}
                </p>
              )}
            </section>
          )}

          {run?.strategyApplication && (
            <section className="rounded-[10px] border border-[var(--color-line)] p-3">
              <p className="text-xs font-extrabold">
                本轮参考策略卡 v{run.strategyApplication.version}
              </p>
              <p className="mt-1 break-all text-[10px] text-[var(--color-muted)]">
                {run.strategyApplication.id}
              </p>
              {!feedbackSent && candidateHooks.length > 0 && (
                <div className="mt-3 space-y-2">
                  <label className="block text-[11px] font-bold">
                    这张策略对本轮结果有帮助吗？
                    <select
                      className="control-base mt-1 min-h-10 w-full px-3 text-xs"
                      onChange={(event) => {
                        const next = event.target.value as StrategyFit | "";
                        setFeedbackFit(next);
                        if (next !== "not_applicable") setFeedbackReason("");
                      }}
                      value={feedbackFit}
                    >
                      <option value="">请选择</option>
                      <option value="helpful">有帮助</option>
                      <option value="unhelpful">无帮助</option>
                      <option value="not_applicable">不适用</option>
                    </select>
                  </label>
                  {feedbackFit === "not_applicable" && (
                    <label className="block text-[11px] font-bold">
                      不适用原因
                      <select
                        className="control-base mt-1 min-h-10 w-full px-3 text-xs"
                        onChange={(event) => setFeedbackReason(event.target.value as StrategyNotApplicableReason | "")}
                        value={feedbackReason}
                      >
                        <option value="">请选择</option>
                        <option value="platform">平台</option>
                        <option value="content_type">内容类型</option>
                        <option value="audience">受众</option>
                        <option value="tone">语气</option>
                        <option value="topic">主题</option>
                        <option value="other">其他</option>
                      </select>
                    </label>
                  )}
                  <button
                    className="button-secondary w-full"
                    disabled={!feedbackFit || (feedbackFit === "not_applicable" && !feedbackReason)}
                    onClick={() => void submitStrategyFeedback()}
                    type="button"
                  >
                    提交策略反馈
                  </button>
                </div>
              )}
              {feedbackSent && (
                <p className="mt-2 text-[11px] font-bold text-[var(--color-success)]">反馈已记录</p>
              )}
            </section>
          )}

          {current?.pendingConfirmation === "final" && (
            <section className="rounded-[10px] border border-[var(--color-success)]/35 bg-[var(--color-success-soft)] p-4">
              <p className="text-xs font-extrabold text-[var(--color-success)]">最终确认</p>
              {selectedCandidate && (
                <p className="mt-2 text-sm font-semibold leading-6">{selectedCandidate.text}</p>
              )}
              <button
                className="button-primary mt-3 w-full"
                disabled={coach.loading || !allowed(allowedCommands, "confirm_final")}
                onClick={() => void coach.submitCommand({ type: "confirm_final" })}
                type="button"
              >
                确认采用
              </button>
              {allowed(allowedCommands, "message") && (
                <button
                  className="button-secondary mt-2 w-full"
                  disabled={coach.loading}
                  onClick={() => void coach.submitCommand({ type: "message", text: "返回候选继续比较" })}
                  type="button"
                >
                  返回继续比较
                </button>
              )}
            </section>
          )}

          {coach.error && run && (
            <div className="rounded-[10px] bg-[var(--color-danger-soft)] p-3 text-xs leading-5 text-[var(--color-danger)]" role="alert">
              <p className="font-extrabold">{coach.error.title}</p>
              <p className="mt-1">{coach.error.message}</p>
            </div>
          )}

          {run?.status === "failed" && run.recoverable && allowed(allowedCommands, "retry") && (
            <button
              className="button-secondary"
              disabled={coach.loading || !needsInput}
              onClick={() => void coach.submitCommand({ type: "retry" })}
              type="button"
            >
              <ArrowClockwise aria-hidden="true" size={15} />
              重试上一步
            </button>
          )}

          {coach.loading && (
            <p className="soft-pulse text-xs font-bold text-[var(--color-accent)]">教练正在处理…</p>
          )}

          {run && isTerminal(run.status) && (
            <section className="rounded-[10px] border border-[var(--color-line)] p-4">
              <CheckCircle aria-hidden="true" className="text-[var(--color-success)]" size={24} weight="fill" />
              <p className="mt-2 text-sm font-black">
                {run.status === "completed" ? "本轮创作已完成" : "本轮任务已取消"}
              </p>
              {run.status === "completed" && (
                <p className="mt-1 text-xs text-[var(--color-muted)]">最终结果已加入历史记录。</p>
              )}
            </section>
          )}
        </div>

        {run && needsInput && allowed(allowedCommands, "message") && run.status === "understanding" && (
          <form className="border-t border-[var(--color-line)] p-3" onSubmit={submitMessage}>
            <label className="sr-only" htmlFor="coach-message">回复创作 Agent</label>
            <textarea
              className="control-base min-h-20 w-full resize-none px-3 py-2 text-sm"
              id="coach-message"
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="补充你已经确定的信息"
              value={message}
            />
            <button className="button-primary mt-2 w-full" disabled={!message.trim() || coach.loading} type="submit">
              发送回复
            </button>
          </form>
        )}

        <section className="border-t border-[var(--color-line)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-extrabold">
              偏好记忆{run ? ` · 本轮参考 ${run.appliedMemoryKeys?.length ?? 0} 项` : ""}
            </p>
            {coach.memory.length > 0 && (
              <button className="text-[11px] font-bold text-[var(--color-danger)]" onClick={() => void coach.clearMemory()} type="button">
                全部清除
              </button>
            )}
          </div>
          {coach.memory.length === 0 ? (
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">暂无已保存偏好</p>
          ) : (
            <ul className="mt-2 max-h-24 space-y-2 overflow-y-auto">
              {coach.memory.map((entry) => (
                <li className="flex items-center justify-between gap-2 text-[11px]" key={entry.id}>
                  <span className="min-w-0 truncate">
                    {MEMORY_LABELS[entry.key] ?? entry.key}：{entry.value}（{Math.round(entry.confidence * 100)}%）
                  </span>
                  <button
                    aria-label={`删除偏好：${MEMORY_LABELS[entry.key] ?? entry.key}`}
                    className="shrink-0 text-[var(--color-danger)]"
                    onClick={() => void coach.deleteMemory(entry.id)}
                    type="button"
                  >
                    <Trash aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {run && !isTerminal(run.status) && (
            <button
              className="mt-3 text-[11px] font-bold text-[var(--color-muted)] underline"
              disabled={coach.loading}
              onClick={() => void coach.cancelRun()}
              type="button"
            >
              取消本轮任务
            </button>
          )}
        </section>
      </aside>
    </>
  ) : null;
});
