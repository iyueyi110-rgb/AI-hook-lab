"use client";

import Image from "next/image";
import * as React from "react";
import {
  ArrowClockwise,
  Camera,
  CheckCircle,
  ChatCircleDots,
  ListChecks,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";
import { HookGrid } from "@/components/HookGrid";
import { useCreativeCoach } from "@/hooks/useCreativeCoach";
import type { AnalyticsEventType } from "@/hooks/useAnalytics";
import { CONTENT_TYPE_CONFIG, EMOTION_TONE_CONFIG, PLATFORM_CONFIG } from "@/lib/constants";
import type { AgentCommand, AgentRunStatus, CreativeBrief, WordLimitBand } from "@/lib/agent/types";
import type { ContentType, EmotionTone, GenerateResponse, HookResult, Platform } from "@/lib/types";
import { buildCoachBriefInput, canEditCoachBrief } from "@/lib/creativeCoachClient";

interface CreativeCoachWorkspaceProps {
  onFinalized: (response: GenerateResponse) => void;
  track: (type: AnalyticsEventType, payload?: Record<string, unknown>) => void;
}

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  understanding: "理解需求",
  analyzing_image: "分析图片",
  awaiting_brief_confirmation: "等待确认简报",
  generating: "生成候选",
  reviewing: "比较候选",
  revising: "改写候选",
  awaiting_final_confirmation: "等待最终确认",
  completed: "已完成",
  failed: "需要重试",
  cancelled: "已取消",
};

const MEMORY_LABELS: Record<string, string> = {
  default_platform: "默认平台",
  preferred_style: "偏好风格",
  avoided_style: "避免风格",
  preferred_tone: "偏好情绪",
  word_limit_band: "字数区间",
  avoid_badcase_tag: "避免问题",
};

const WORD_BANDS: WordLimitBand[] = ["30-50", "60-80", "90-110", "120-150"];

function toHook(candidate: NonNullable<ReturnType<typeof useCreativeCoach>["response"]>["candidates"][number]): HookResult {
  return {
    id: candidate.id,
    text: candidate.text,
    style: candidate.style,
    reasoning: candidate.reasoning,
    score: candidate.overallScore,
    overallScore: candidate.overallScore,
    scores: candidate.scores,
    badcaseTags: candidate.badcaseTags,
  };
}

function allowed(allowedCommands: AgentCommand["type"][], command: AgentCommand["type"]): boolean {
  return allowedCommands.includes(command);
}

export function CreativeCoachWorkspace({ onFinalized, track }: CreativeCoachWorkspaceProps) {
  const coach = useCreativeCoach({ onFinalized, track });
  const [topic, setTopic] = React.useState("");
  const [platform, setPlatform] = React.useState<Platform>("xiaohongshu");
  const [platformTouched, setPlatformTouched] = React.useState(false);
  const [contentType, setContentType] = React.useState<ContentType>("video");
  const [targetAudience, setTargetAudience] = React.useState("");
  const [emotionTone, setEmotionTone] = React.useState<EmotionTone>("curious");
  const [emotionToneTouched, setEmotionToneTouched] = React.useState(false);
  const [wordLimitBand, setWordLimitBand] = React.useState<WordLimitBand>("60-80");
  const [wordLimitTouched, setWordLimitTouched] = React.useState(false);
  const [briefEdits, setBriefEdits] = React.useState<Partial<CreativeBrief>>({});
  const [ignoreMemory, setIgnoreMemory] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [rewriteId, setRewriteId] = React.useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = React.useState("");
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const [coachOpen, setCoachOpen] = React.useState(false);
  const [modalViewport, setModalViewport] = React.useState(false);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const openButtonRef = React.useRef<HTMLButtonElement>(null);
  const coachPanelRef = React.useRef<HTMLElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  const current = coach.response;
  const run = current?.run;
  const rememberedPlatform = coach.memory.find((entry) => entry.key === "default_platform")?.value as Platform | undefined;
  const rememberedTone = coach.memory.find((entry) => entry.key === "preferred_tone")?.value as EmotionTone | undefined;
  const rememberedWordBand = coach.memory.find((entry) => entry.key === "word_limit_band")?.value as WordLimitBand | undefined;
  const allowedCommands = current?.allowedCommands ?? [];
  const needsInput = Boolean(current?.needsInput);
  const briefEditable = canEditCoachBrief(run, allowedCommands, needsInput);
  const candidates = React.useMemo(() => current?.candidates.map(toHook) ?? [], [current?.candidates]);
  const topIds = current?.topCandidates.map((candidate) => candidate.id) ?? [];
  const displayedTopic = run ? briefEdits.topic ?? run.briefDraft?.topic ?? "" : topic;
  const displayedPlatform = run
    ? briefEdits.platform ?? run.briefDraft?.platform ?? platform
    : !ignoreMemory && !platformTouched && rememberedPlatform && rememberedPlatform in PLATFORM_CONFIG ? rememberedPlatform : platform;
  const displayedContentType = run ? briefEdits.contentType ?? run.briefDraft?.contentType ?? contentType : contentType;
  const displayedTargetAudience = run ? briefEdits.targetAudience ?? run.briefDraft?.targetAudience ?? "" : targetAudience;
  const displayedEmotionTone = run
    ? briefEdits.emotionTone ?? run.briefDraft?.emotionTone ?? emotionTone
    : !ignoreMemory && !emotionToneTouched && rememberedTone && rememberedTone in EMOTION_TONE_CONFIG ? rememberedTone : emotionTone;
  const displayedWordLimitBand = run
    ? briefEdits.wordLimitBand ?? run.briefDraft?.wordLimitBand ?? wordLimitBand
    : !ignoreMemory && !wordLimitTouched && rememberedWordBand && WORD_BANDS.includes(rememberedWordBand) ? rememberedWordBand : wordLimitBand;
  const displayedImageDescription = run ? briefEdits.imageDescription ?? run.briefDraft?.imageDescription ?? "" : "";
  const modalOpen = coachOpen && modalViewport;

  React.useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setModalViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  React.useEffect(() => {
    if (modalOpen) closeButtonRef.current?.focus();
  }, [modalOpen]);

  const openCoach = React.useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCoachOpen(true);
  }, []);

  const closeCoach = React.useCallback(() => {
    const returnTarget = previousFocusRef.current ?? openButtonRef.current;
    setCoachOpen(false);
    queueMicrotask(() => returnTarget?.focus());
  }, []);

  React.useEffect(() => {
    const handleDialogKey = (event: KeyboardEvent) => {
      if (!modalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeCoach();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = coachPanelRef.current;
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
  }, [closeCoach, modalOpen]);

  const brief = React.useMemo<Partial<CreativeBrief>>(() => buildCoachBriefInput({
    topic: displayedTopic,
    platform: displayedPlatform,
    contentType: displayedContentType,
    targetAudience: displayedTargetAudience,
    emotionTone: displayedEmotionTone,
    wordLimitBand: displayedWordLimitBand,
    imageDescription: displayedImageDescription,
  }, {
    ignoreMemory,
    platformTouched,
    emotionToneTouched,
    wordLimitTouched,
    rememberedPlatform,
    rememberedTone,
    rememberedWordBand,
  }), [displayedContentType, displayedEmotionTone, displayedImageDescription, displayedPlatform, displayedTargetAudience, displayedTopic, displayedWordLimitBand, emotionToneTouched, ignoreMemory, platformTouched, rememberedPlatform, rememberedTone, rememberedWordBand, wordLimitTouched]);
  const structuredBrief = React.useMemo<Partial<CreativeBrief>>(() => ({
    ...(run?.briefDraft ?? {}),
    ...brief,
    topic: displayedTopic.trim(),
    platform: displayedPlatform,
    contentType: displayedContentType,
    emotionTone: displayedEmotionTone,
    wordLimitBand: displayedWordLimitBand,
  }), [brief, displayedContentType, displayedEmotionTone, displayedPlatform, displayedTopic, displayedWordLimitBand, run?.briefDraft]);

  const start = async () => {
    if (!displayedTopic.trim() || coach.loading) return;
    const created = await coach.createRun({ brief, hasImage: Boolean(imageFile), ignoreMemory });
    if (created && imageFile) await coach.uploadImage(imageFile, created);
  };

  const submitMessage = () => {
    const text = message.trim();
    if (!text || !allowed(allowedCommands, "message")) return;
    setMessage("");
    void coach.submitCommand({ type: "message", text });
  };

  const selectImage = (file?: File) => {
    if (!file) return;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageFile(null);
  };

  const changeIgnoreMemory = (checked: boolean) => {
    setIgnoreMemory(checked);
    if (checked) {
      if (!platformTouched) setPlatform("xiaohongshu");
      if (!emotionToneTouched) setEmotionTone("curious");
      if (!wordLimitTouched) setWordLimitBand("60-80");
    }
  };

  const reset = () => {
    coach.reset();
    setBriefEdits({});
    clearImage();
    setRewriteId(null);
    setRejectOpen(false);
    setPlatformTouched(false);
    setEmotionToneTouched(false);
    setWordLimitTouched(false);
  };

  const retryImageOperation = async () => {
    const retried = await coach.submitCommand({ type: "retry" });
    if (retried?.run.status === "analyzing_image" && imageFile) {
      await coach.uploadImage(imageFile, retried);
    }
  };

  const briefPanel = (
    <section aria-labelledby="coach-brief-heading" className="editorial-panel overflow-hidden xl:sticky xl:top-24">
      <div className="border-b border-[var(--color-line)] p-5">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]">
          <SlidersHorizontal aria-hidden="true" size={16} weight="bold" />
          创作简报
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.035em]" id="coach-brief-heading">把需求说清楚，再开始写。</h1>
        <p className="mt-2 text-xs leading-5 text-[var(--color-graphite)]">主题、平台和内容类型是必填项。教练最多补问两次。</p>
      </div>
      <div className="space-y-4 p-5">
        {(!run || run?.status === "analyzing_image") && (
          <div>
            <label className="mb-2 block text-xs font-extrabold" htmlFor="coach-image">内容截图{run ? "（需要重新选择）" : "（可选）"}</label>
            <div className="relative rounded-[10px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-canvas)] p-3">
              <input accept="image/jpeg,image/png,image/webp" className="sr-only" id="coach-image" onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ""; }} type="file" />
              <label className="flex min-h-20 cursor-pointer items-center gap-3" htmlFor="coach-image">
                {imagePreview ? (
                  <Image alt="待分析的内容截图" className="h-20 w-20 rounded-md border border-[var(--color-line)] object-cover" height={80} src={imagePreview} unoptimized width={80} />
                ) : <Camera aria-hidden="true" className="text-[var(--color-accent)]" size={24} weight="bold" />}
                <span className="text-xs font-bold leading-5">{imageFile ? imageFile.name : "上传 JPEG、PNG 或 WebP，最大 5MB"}</span>
              </label>
              {imageFile && <button aria-label="清除内容截图" className="absolute right-2 top-2 button-secondary !min-h-8 !p-1.5" onClick={clearImage} type="button"><X aria-hidden="true" size={14} /></button>}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[var(--color-muted)]">图片走创作教练分析接口，原图不保存，也不会写入浏览器历史。</p>
            {run?.status === "analyzing_image" && (
              <button className="button-secondary mt-3 w-full" disabled={!imageFile || coach.loading} onClick={() => imageFile && void coach.uploadImage(imageFile)} type="button">分析这张图片</button>
            )}
          </div>
        )}
        <div>
          <label className="mb-2 block text-xs font-extrabold" htmlFor="coach-topic">主题</label>
          <textarea className="control-base min-h-24 w-full resize-none px-3 py-2 text-sm" disabled={coach.loading || !briefEditable} id="coach-topic" maxLength={500} onChange={(event) => run ? setBriefEdits((currentEdits) => ({ ...currentEdits, topic: event.target.value })) : setTopic(event.target.value)} placeholder="例如：用 AI 写好每周复盘" value={displayedTopic} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="text-xs font-extrabold">发布平台
            <select className="control-base mt-2 h-10 w-full px-3 text-sm" disabled={coach.loading || !briefEditable} onChange={(event) => { setPlatformTouched(true); if (run) setBriefEdits((currentEdits) => ({ ...currentEdits, platform: event.target.value as Platform })); else setPlatform(event.target.value as Platform); }} value={displayedPlatform}>
              {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((item) => <option key={item} value={item}>{PLATFORM_CONFIG[item].label}</option>)}
            </select>
          </label>
          <label className="text-xs font-extrabold">内容类型
            <select className="control-base mt-2 h-10 w-full px-3 text-sm" disabled={coach.loading || !briefEditable} onChange={(event) => run ? setBriefEdits((currentEdits) => ({ ...currentEdits, contentType: event.target.value as ContentType })) : setContentType(event.target.value as ContentType)} value={displayedContentType}>
              {(Object.keys(CONTENT_TYPE_CONFIG) as ContentType[]).map((item) => <option key={item} value={item}>{CONTENT_TYPE_CONFIG[item].label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-extrabold">目标用户
          <input className="control-base mt-2 h-10 w-full px-3 text-sm" disabled={coach.loading || !briefEditable} maxLength={300} onChange={(event) => run ? setBriefEdits((currentEdits) => ({ ...currentEdits, targetAudience: event.target.value })) : setTargetAudience(event.target.value)} placeholder="留空则使用默认受众" value={displayedTargetAudience} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="text-xs font-extrabold">情绪风格
            <select className="control-base mt-2 h-10 w-full px-3 text-sm" disabled={coach.loading || !briefEditable} onChange={(event) => { setEmotionToneTouched(true); if (run) setBriefEdits((currentEdits) => ({ ...currentEdits, emotionTone: event.target.value as EmotionTone })); else setEmotionTone(event.target.value as EmotionTone); }} value={displayedEmotionTone}>
              {(Object.keys(EMOTION_TONE_CONFIG) as EmotionTone[]).map((item) => <option key={item} value={item}>{EMOTION_TONE_CONFIG[item].label}</option>)}
            </select>
          </label>
          <label className="text-xs font-extrabold">字数区间
            <select className="control-base mt-2 h-10 w-full px-3 text-sm" disabled={coach.loading || !briefEditable} onChange={(event) => { setWordLimitTouched(true); if (run) setBriefEdits((currentEdits) => ({ ...currentEdits, wordLimitBand: event.target.value as WordLimitBand })); else setWordLimitBand(event.target.value as WordLimitBand); }} value={displayedWordLimitBand}>
              {WORD_BANDS.map((item) => <option key={item} value={item}>{item} 字</option>)}
            </select>
          </label>
        </div>
        {run?.briefDraft?.imageDescription && (
          <div className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-subtle)] p-3">
            <label className="text-[11px] font-extrabold" htmlFor="coach-image-description">图片结构化理解</label>
            <textarea
              className="control-base mt-2 min-h-24 w-full resize-y px-3 py-2 text-xs leading-5"
              disabled={coach.loading || !briefEditable}
              id="coach-image-description"
              maxLength={500}
              onChange={(event) => setBriefEdits((currentEdits) => ({ ...currentEdits, imageDescription: event.target.value }))}
              value={displayedImageDescription}
            />
            <p className="mt-2 text-[10px] text-[var(--color-muted)]">如理解有偏差，请在确认简报前直接修正；生成会使用这里的内容。</p>
          </div>
        )}
        {run?.status === "understanding" && run.requiresFormCompletion && (
          <button
            className="button-primary w-full"
            disabled={coach.loading || !displayedTopic.trim() || !displayedPlatform || !displayedContentType || !allowed(allowedCommands, "message")}
            onClick={() => void coach.submitCommand({ type: "message", text: JSON.stringify(structuredBrief) })}
            type="button"
          >
            <ListChecks aria-hidden="true" size={17} weight="bold" />
            提交完整简报
          </button>
        )}
        {!run && (
          <label className="flex items-start gap-2 text-xs leading-5 text-[var(--color-graphite)]">
            <input checked={ignoreMemory} className="mt-1 accent-[var(--color-accent)]" onChange={(event) => changeIgnoreMemory(event.target.checked)} type="checkbox" />
            本轮忽略已保存偏好
          </label>
        )}
        {!run ? (
          <button className="button-primary w-full" disabled={!displayedTopic.trim() || coach.loading || coach.restoring} onClick={() => void start()} type="button">
            <ChatCircleDots aria-hidden="true" size={18} weight="bold" />
            {coach.loading ? "正在创建…" : "开始创作教练"}
          </button>
        ) : null}
      </div>
    </section>
  );

  const candidatePanel = (
    <section aria-live="polite" className="min-w-0 space-y-4">
      {!run && !coach.restoring && (
        <div className="editorial-panel grid min-h-[430px] content-between p-6">
          <div><p className="text-xs font-extrabold text-[var(--color-accent)]">候选工作区</p><h2 className="mt-4 max-w-[16ch] text-3xl font-black leading-tight tracking-[-0.035em]">先确认简报，再比较十个方向。</h2><p className="mt-3 max-w-[58ch] text-sm leading-6 text-[var(--color-graphite)]">教练会解释 Top 3 的排序依据。模型分只作参考，采用决定始终由你确认。</p></div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3"><div className="bg-white p-4 text-xs leading-5">一次补问一个关键字段</div><div className="bg-white p-4 text-xs leading-5">首轮固定生成 10 条</div><div className="bg-white p-4 text-xs leading-5">单条改写固定返回 3 条</div></div>
        </div>
      )}
      {coach.restoring && <div className="editorial-panel min-h-[300px] p-6 soft-pulse" aria-label="正在恢复创作教练">正在恢复上次任务…</div>}
      {run && candidates.length === 0 && (
        <div className="editorial-panel p-6">
          <p className="text-xs font-extrabold text-[var(--color-accent)]">{STATUS_LABELS[run.status]}</p>
          <h2 className="mt-3 text-2xl font-black">{run.status === "awaiting_brief_confirmation" ? "请确认简报" : run.status === "analyzing_image" ? "正在理解图片" : "教练正在准备下一步"}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">所有生成与改写都需要明确状态和人工确认，不会在后台无限迭代。</p>
          {current?.pendingConfirmation === "brief" && (
            <button className="button-primary mt-5" disabled={!needsInput || !allowed(allowedCommands, "confirm_brief") || coach.loading} onClick={() => void coach.submitCommand({ type: "confirm_brief", briefPatch: brief })} type="button"><CheckCircle aria-hidden="true" size={17} weight="bold" />确认简报并生成 10 条</button>
          )}
        </div>
      )}
      {candidates.length > 0 && (
        <HookGrid
          coachActions={{
            onRewrite: (id) => { setRewriteId(id); setRejectOpen(false); },
            onSelect: (id) => void coach.submitCommand({ type: "select_candidate", candidateId: id }),
            canRewrite: needsInput && allowed(allowedCommands, "rewrite_candidate") && !coach.loading,
            canSelect: needsInput && allowed(allowedCommands, "select_candidate") && !coach.loading,
            canReject: needsInput && allowed(allowedCommands, "reject_batch") && !coach.loading,
            selectedId: run?.selectedCandidateId,
            recommendedIds: topIds,
            comparisonExplanations: current?.comparisonExplanations ?? [],
            rejecting: coach.loading,
          }}
          favoritedIds={[]}
          hooks={candidates}
          onCopyHook={() => undefined}
          onRejectBatch={() => { if (allowed(allowedCommands, "reject_batch")) { setRejectOpen(true); setRewriteId(null); } }}
          onSetSatisfaction={() => undefined}
          onToggleAdopted={() => undefined}
          onToggleFavorite={() => undefined}
        />
      )}
      {rewriteId && (
        <form className="editorial-panel p-5" onSubmit={(event) => { event.preventDefault(); void coach.submitCommand({ type: "rewrite_candidate", candidateId: rewriteId, ...(rewriteInstruction.trim() ? { instruction: rewriteInstruction.trim() } : {}) }); setRewriteId(null); setRewriteInstruction(""); }}>
          <label className="text-sm font-extrabold" htmlFor="rewrite-instruction">希望怎样改写这条？</label>
          <textarea className="control-base mt-3 min-h-20 w-full px-3 py-2 text-sm" id="rewrite-instruction" maxLength={1000} onChange={(event) => setRewriteInstruction(event.target.value)} placeholder="例如：语气更克制，保留数字信息" value={rewriteInstruction} />
          <div className="mt-3 flex gap-2"><button className="button-primary" disabled={coach.loading || !allowed(allowedCommands, "rewrite_candidate")} type="submit">生成 3 条改写</button><button className="button-secondary" onClick={() => setRewriteId(null)} type="button">取消</button></div>
        </form>
      )}
      {rejectOpen && (
        <form className="editorial-panel p-5" onSubmit={(event) => { event.preventDefault(); void coach.submitCommand({ type: "reject_batch", ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}) }); setRejectOpen(false); setRejectReason(""); }}>
          <label className="text-sm font-extrabold" htmlFor="reject-reason">这批候选最主要的问题是什么？</label>
          <textarea className="control-base mt-3 min-h-20 w-full px-3 py-2 text-sm" id="reject-reason" maxLength={1000} onChange={(event) => setRejectReason(event.target.value)} placeholder="例如：都太像广告，没有个人经验感" value={rejectReason} />
          <div className="mt-3 flex gap-2"><button className="button-primary" disabled={coach.loading || !allowed(allowedCommands, "reject_batch")} type="submit">重新生成 10 条</button><button className="button-secondary" onClick={() => setRejectOpen(false)} type="button">取消</button></div>
        </form>
      )}
      {current?.pendingConfirmation === "final" && (
        <section className="editorial-panel border-t-2 border-t-[var(--color-success)] p-5">
          <p className="text-xs font-extrabold text-[var(--color-success)]">最终确认</p>
          <h2 className="mt-2 text-xl font-black">确认采用所选 Hook？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">确认后会保存结果，并写入现有历史记录。也可以返回候选继续比较。</p>
          <div className="mt-4 flex flex-wrap gap-2"><button className="button-primary" disabled={coach.loading || !allowed(allowedCommands, "confirm_final")} onClick={() => void coach.submitCommand({ type: "confirm_final" })} type="button">确认采用</button><button className="button-secondary" disabled={coach.loading || !allowed(allowedCommands, "message")} onClick={() => void coach.submitCommand({ type: "message", text: "返回候选继续修改" })} type="button">返回修改</button></div>
        </section>
      )}
      {run && ["completed", "cancelled"].includes(run.status) && <section className="editorial-panel p-5"><CheckCircle aria-hidden="true" className="text-[var(--color-success)]" size={26} weight="fill" /><h2 className="mt-3 text-xl font-black">{run.status === "completed" ? "本轮创作已完成" : "本轮任务已取消"}</h2>{run.status === "completed" && <p className="mt-2 text-sm text-[var(--color-graphite)]">最终结果已加入历史记录。</p>}<button className="button-secondary mt-4" onClick={reset} type="button">开始新任务</button></section>}
    </section>
  );

  const coachPanel = (
    <aside
      aria-label="创作教练对话"
      aria-modal={modalOpen || undefined}
      className={`editorial-panel z-40 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden xl:sticky xl:top-24 max-xl:fixed max-xl:bottom-4 max-xl:right-4 max-xl:top-24 max-xl:w-[360px] max-xl:shadow-[var(--shadow-panel)] max-md:inset-0 max-md:max-h-none max-md:w-auto max-md:rounded-none ${coachOpen ? "max-xl:flex" : "max-xl:hidden"}`}
      ref={coachPanelRef}
      role={modalOpen ? "dialog" : undefined}
      tabIndex={modalOpen ? -1 : undefined}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-line)] p-4">
        <div><p className="text-xs font-extrabold text-[var(--color-accent)]">创作教练</p><p className="mt-1 text-sm font-black">{run ? STATUS_LABELS[run.status] : "等待开始"}</p></div>
        <button aria-label="关闭创作教练面板" className="button-secondary !min-h-8 !p-1.5 xl:!hidden" onClick={closeCoach} ref={closeButtonRef} type="button"><X aria-hidden="true" size={16} /></button>
      </div>
      <div aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!run && <p className="rounded-[10px] bg-[var(--color-surface-subtle)] p-3 text-xs leading-5">填写左侧简报后开始。我会按当前状态补问、比较和改写，不展示隐藏推理。</p>}
        {run?.messages.filter((item) => item.role !== "tool").map((item) => <div className={`max-w-[92%] rounded-[10px] px-3 py-2 text-xs leading-5 ${item.role === "user" ? "ml-auto bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface-subtle)]"}`} key={item.id}>{item.content}</div>)}
        {run?.toolCalls.slice(-4).map((call) => <p className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]" key={call.id}><ListChecks aria-hidden="true" size={14} />{call.tool === "analyze_image" ? "图片分析" : call.tool === "compare_candidates" ? "候选比较" : call.tool === "save_final_choice" ? "保存最终选择" : "生成候选"}：{call.status === "completed" ? "已完成" : "进行中"}</p>)}
        {coach.error && <div className="rounded-[10px] bg-[var(--color-danger-soft)] p-3 text-xs leading-5 text-[var(--color-danger)]" role="alert"><p className="font-extrabold">{coach.error.title}</p><p className="mt-1">{coach.error.message}</p></div>}
        {run?.status === "failed" && run.recoverable && allowed(allowedCommands, "retry") && (
          <div className="rounded-[10px] border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-xs leading-5">
            <p className="font-extrabold">上一步可以安全重试</p>
            {run.resumeStatus === "analyzing_image" && !imageFile && <p className="mt-1 text-[var(--color-graphite)]">请先在简报区重新选择原图片。</p>}
            <button className="button-secondary mt-3" disabled={coach.loading || !needsInput || (run.resumeStatus === "analyzing_image" && !imageFile)} onClick={() => run.resumeStatus === "analyzing_image" ? void retryImageOperation() : void coach.submitCommand({ type: "retry" })} type="button"><ArrowClockwise aria-hidden="true" size={15} />重试</button>
          </div>
        )}
        {coach.loading && <p className="soft-pulse text-xs font-bold text-[var(--color-accent)]">教练正在处理…</p>}
      </div>
      {run && needsInput && allowed(allowedCommands, "message") && run.status === "understanding" && (
        <form className="border-t border-[var(--color-line)] p-3" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
          <label className="sr-only" htmlFor="coach-message">回复创作教练</label>
          <textarea className="control-base min-h-20 w-full resize-none px-3 py-2 text-sm" id="coach-message" maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder="回复缺失信息" value={message} />
          <button className="button-primary mt-2 w-full" disabled={!message.trim() || coach.loading} type="submit">发送回复</button>
        </form>
      )}
      <div className="border-t border-[var(--color-line)] p-4">
        <div className="flex items-center justify-between"><p className="text-xs font-extrabold">偏好记忆{run ? ` · 本轮已参考 ${run.appliedMemoryKeys?.length ?? 0} 项` : ""}</p>{coach.memory.length > 0 && <button className="text-[11px] font-bold text-[var(--color-danger)]" onClick={() => void coach.clearMemory()} type="button">全部清除</button>}</div>
        {coach.memory.length === 0 ? <p className="mt-2 text-[11px] text-[var(--color-muted)]">暂无已保存偏好</p> : <ul className="mt-2 space-y-2">{coach.memory.map((entry) => <li className="flex items-center justify-between gap-2 text-[11px]" key={entry.id}><span className="min-w-0 truncate">{MEMORY_LABELS[entry.key] ?? entry.key}：{entry.value}（{Math.round(entry.confidence * 100)}%）</span><button aria-label={`删除偏好：${MEMORY_LABELS[entry.key] ?? entry.key}`} className="shrink-0 text-[var(--color-danger)]" onClick={() => void coach.deleteMemory(entry.id)} type="button"><Trash aria-hidden="true" size={14} /></button></li>)}</ul>}
        {run && !["completed", "cancelled"].includes(run.status) && <button className="mt-3 text-[11px] font-bold text-[var(--color-muted)] underline" disabled={coach.loading} onClick={() => void coach.cancelRun()} type="button">取消本轮任务</button>}
      </div>
    </aside>
  );

  return (
    <main className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-6 pb-20 md:px-6 md:py-8 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)_360px] xl:items-start">
      <div aria-hidden={modalOpen || undefined} className="contents" inert={modalOpen ? true : undefined}>
        {briefPanel}
        {candidatePanel}
      </div>
      {coachPanel}
      <div aria-hidden={modalOpen || undefined} className="contents" inert={modalOpen ? true : undefined}>
        <button aria-expanded={coachOpen} aria-label="打开创作教练面板" className="button-primary fixed bottom-4 right-4 z-30 xl:!hidden" onClick={openCoach} ref={openButtonRef} type="button"><ChatCircleDots aria-hidden="true" size={18} weight="bold" />教练</button>
      </div>
      {coachOpen && <button aria-label="关闭创作教练遮罩" className="fixed inset-0 z-30 bg-black/25 max-md:hidden xl:hidden" onClick={closeCoach} type="button" />}
    </main>
  );
}
