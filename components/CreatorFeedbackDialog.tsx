"use client";

import { ChatCircleText, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  FEEDBACK_REASON_OPTIONS,
  FEEDBACK_USAGE_OUTCOMES,
  getFeedbackFormError,
  type CreatorFeedbackRequest,
  type CreatorFeedbackSubmission,
  type FeedbackReasonTag,
  type FeedbackUsageOutcome,
} from "@/lib/creatorFeedback";

interface CreatorFeedbackDialogProps {
  request: CreatorFeedbackRequest | null;
  onSkip: () => void;
  onSubmit: (submission: CreatorFeedbackSubmission) => void;
}

const copyByTrigger: Record<
  CreatorFeedbackRequest["trigger"],
  { eyebrow: string; title: string; description: string }
> = {
  adoption: {
    eyebrow: "采用反馈",
    title: "这条 Hook 会怎么用？",
    description: "真实使用方式能帮助我们区分“看起来不错”和“真正能用”。",
  },
  explicit_batch_reject: {
    eyebrow: "放弃原因",
    title: "这批 Hook 为什么不合适？",
    description: "选出最主要的原因，帮助下一轮更接近你的创作需求。",
  },
  sampled_before_regenerate: {
    eyebrow: "快速反馈",
    title: "再次生成前，哪里最需要改进？",
    description: "这是一次抽样询问，提交或跳过后都会继续生成。",
  },
  low_satisfaction: {
    eyebrow: "低分原因",
    title: "这条 Hook 主要差在哪里？",
    description: "评分已经保存，再补一个原因会让问题更容易定位。",
  },
};

export function CreatorFeedbackDialog({
  request,
  onSkip,
  onSubmit,
}: CreatorFeedbackDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [usageOutcome, setUsageOutcome] = useState<FeedbackUsageOutcome>();
  const [reasonTags, setReasonTags] = useState<FeedbackReasonTag[]>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panelRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onSkip, request]);

  if (!request) return null;

  const copy = copyByTrigger[request.trigger];
  const needsReasons = !(request.trigger === "adoption" && usageOutcome === "direct_use");

  const toggleReason = (reason: FeedbackReasonTag) => {
    setError("");
    setReasonTags((current) => {
      if (current.includes(reason)) return current.filter((item) => item !== reason);
      if (current.length >= 3) {
        setError("最多选择 3 个原因");
        return current;
      }
      return [...current, reason];
    });
  };

  const handleSubmit = () => {
    const trimmedComment = comment.trim();
    const formError = getFeedbackFormError(
      request.trigger,
      usageOutcome,
      reasonTags,
      trimmedComment,
    );
    if (formError) {
      setError(formError);
      return;
    }
    onSubmit({
      usageOutcome,
      reasonTags,
      comment: trimmedComment || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5">
      <div
        aria-describedby="creator-feedback-description"
        aria-labelledby="creator-feedback-title"
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[16px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl outline-none sm:max-w-xl sm:rounded-[14px]"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-extrabold text-[var(--color-accent)]">
              <ChatCircleText aria-hidden="true" size={15} weight="fill" />
              {copy.eyebrow}
            </p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.025em]" id="creator-feedback-title">
              {copy.title}
            </h2>
            <p className="mt-2 max-w-[58ch] text-xs leading-5 text-[var(--color-muted)]" id="creator-feedback-description">
              {copy.description}
            </p>
          </div>
          <button aria-label="跳过并关闭反馈" className="button-secondary h-10 min-h-10 w-10 justify-center p-0" onClick={onSkip} type="button">
            <X aria-hidden="true" size={17} weight="bold" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          {request.trigger === "adoption" && (
            <fieldset>
              <legend className="text-xs font-extrabold">实际使用方式</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {FEEDBACK_USAGE_OUTCOMES.map((option) => (
                  <button
                    aria-pressed={usageOutcome === option.value}
                    className={`min-h-16 rounded-[9px] border px-3 py-2.5 text-left transition-colors ${
                      usageOutcome === option.value
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                        : "border-[var(--color-line)] bg-white hover:border-[var(--color-line-strong)]"
                    }`}
                    key={option.value}
                    onClick={() => {
                      setUsageOutcome(option.value);
                      setReasonTags([]);
                      setComment("");
                      setError("");
                    }}
                    type="button"
                  >
                    <span className="block text-xs font-extrabold">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-[var(--color-muted)]">{option.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {needsReasons && (
            <fieldset>
              <legend className="text-xs font-extrabold">主要原因 <span className="font-normal text-[var(--color-muted)]">（选 1–3 项）</span></legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {FEEDBACK_REASON_OPTIONS.map((option) => (
                  <button
                    aria-pressed={reasonTags.includes(option.value)}
                    className={`min-h-10 rounded-full border px-3 text-xs font-bold transition-colors ${
                      reasonTags.includes(option.value)
                        ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                        : "border-[var(--color-line)] bg-white text-[var(--color-graphite)] hover:border-[var(--color-ink)]"
                    }`}
                    key={option.value}
                    onClick={() => toggleReason(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {needsReasons && (
            <label className="block text-xs font-extrabold">
              可选补充
              <textarea
                className="control-base mt-2 min-h-24 w-full resize-y px-3 py-2.5 text-sm font-normal leading-6"
                maxLength={100}
                onChange={(event) => {
                  setComment(event.target.value);
                  setError("");
                }}
                placeholder="不用写长问卷，一句话说明即可"
                value={comment}
              />
              <span className="mt-1 block text-right text-[10px] font-normal tabular-nums text-[var(--color-muted)]">{comment.length}/100</span>
            </label>
          )}

          {error && <p aria-live="polite" className="text-xs font-bold text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] px-5 py-4 sm:px-6">
          <button className="button-secondary" onClick={onSkip} type="button">跳过</button>
          <button className="button-primary" onClick={handleSubmit} type="button">提交反馈</button>
        </div>
      </div>
    </div>
  );
}
