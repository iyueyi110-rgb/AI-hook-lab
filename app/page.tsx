"use client";

import React from "react";
import type {
  Platform,
  ContentType,
  EmotionTone,
  GenerateStatus,
  HookResult,
  GenerateResponse,
  ImageAnalysisResult,
  PlatformSatisfaction,
} from "@/lib/types";
import { useHistory } from "@/hooks/useHistory";
import { useFavorites } from "@/hooks/useFavorites";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  createTaskId,
  getOrCreateAnonymousCreatorId,
  shouldSampleFeedback,
  type CreatorFeedbackRequest,
  type CreatorFeedbackSubmission,
} from "@/lib/creatorFeedback";
import { AppHeader } from "@/components/AppHeader";
import { InputPanel } from "@/components/InputPanel";
import { SkeletonCards } from "@/components/SkeletonCards";
import { HookGrid } from "@/components/HookGrid";
import { HistoryDrawer } from "@/components/HistoryDrawer";
import { FavoritesDrawer } from "@/components/FavoritesDrawer";
import { CreatorFeedbackDialog } from "@/components/CreatorFeedbackDialog";
import { CreativeCoachWorkspace } from "@/components/CreativeCoachWorkspace";
import { isCreativeCoachEnabled } from "@/lib/creativeCoachClient";
import {
  ArrowClockwise,
  CheckCircle,
  Copy,
  Heart,
  WarningCircle,
} from "@phosphor-icons/react";

export default function Home() {
  const coachEnabled = isCreativeCoachEnabled(process.env.NEXT_PUBLIC_AGENT_COACH_ENABLED);
  const [mode, setMode] = React.useState<"classic" | "coach">("classic");
  const [topic, setTopic] = React.useState("");
  const [platform, setPlatform] = React.useState<Platform>("xiaohongshu");
  const [contentType, setContentType] = React.useState<ContentType>("video");
  const [status, setStatus] = React.useState<GenerateStatus>("idle");
  const [hooks, setHooks] = React.useState<HookResult[]>([]);
  const [targetAudience, setTargetAudience] = React.useState("");
  const [emotionTone, setEmotionTone] = React.useState<EmotionTone | "">("");
  const [wordLimit, setWordLimit] = React.useState(80);
  const [analysis, setAnalysis] = React.useState<GenerateResponse["analysis"] | null>(null);
  const [error, setError] = React.useState<{ title: string; message: string } | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [favoritesOpen, setFavoritesOpen] = React.useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [imageAnalysis, setImageAnalysis] = React.useState<ImageAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [imageAnalysisError, setImageAnalysisError] = React.useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = React.useState<string | null>(null);
  const [currentBatchContext, setCurrentBatchContext] = React.useState<{
    taskId: string;
    platform: Platform;
    contentType: ContentType;
    templateVersion?: string;
    promptVariant?: string;
  } | null>(null);
  const [feedbackRequest, setFeedbackRequest] = React.useState<CreatorFeedbackRequest | null>(null);
  const [anonymousCreatorId] = React.useState(() => {
    if (typeof window === "undefined") return "";
    return getOrCreateAnonymousCreatorId(window.localStorage);
  });
  const imageRequestRef = React.useRef<AbortController | null>(null);
  const imageRequestIdRef = React.useRef(0);
  const imagePreviewRef = React.useRef<string | null>(null);
  const touchedSinceUploadRef = React.useRef({
    topic: false,
    platform: false,
    contentType: false,
    emotionTone: false,
  });
  const sampledTaskIdsRef = React.useRef(new Set<string>());

  const { history, loaded: historyLoaded, addToHistory, deleteHistory, clearAll, toggleFavorite: toggleHistoryFavorite, updateHook } = useHistory();
  const { favorites, toggleFavorite } = useFavorites();
  const { track, trackSatisfaction, hasDecisionFeedbackForTask, stats } = useAnalytics();

  const handleCoachFinalized = React.useCallback((response: GenerateResponse) => {
    addToHistory(response);
  }, [addToHistory]);

  React.useEffect(
    () => () => {
      imageRequestRef.current?.abort();
      if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    },
    []
  );

  const handleTopicChange = React.useCallback((value: string) => {
    if (imagePreviewRef.current) touchedSinceUploadRef.current.topic = true;
    setTopic(value);
  }, []);

  const handlePlatformChange = React.useCallback((value: Platform) => {
    if (imagePreviewRef.current) touchedSinceUploadRef.current.platform = true;
    setPlatform(value);
  }, []);

  const handleContentTypeChange = React.useCallback((value: ContentType) => {
    if (imagePreviewRef.current) touchedSinceUploadRef.current.contentType = true;
    setContentType(value);
  }, []);

  const handleEmotionToneChange = React.useCallback((value: EmotionTone | "") => {
    if (imagePreviewRef.current) touchedSinceUploadRef.current.emotionTone = true;
    setEmotionTone(value);
  }, []);

  const handleClearImage = React.useCallback(() => {
    imageRequestRef.current?.abort();
    imageRequestRef.current = null;
    imageRequestIdRef.current += 1;
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    imagePreviewRef.current = null;
    touchedSinceUploadRef.current = {
      topic: false,
      platform: false,
      contentType: false,
      emotionTone: false,
    };
    setImagePreviewUrl(null);
    setImageAnalysis(null);
    setImageAnalysisError(null);
    setIsAnalyzing(false);
  }, []);

  const handleImageSelect = React.useCallback(async (file: File) => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const maxBytes = 5 * 1024 * 1024;

    if (!allowedTypes.has(file.type)) {
      setImageAnalysisError("仅支持 JPEG、PNG 或 WebP 图片");
      return;
    }
    if (file.size === 0) {
      setImageAnalysisError("图片内容为空，请选择其他图片");
      return;
    }
    if (file.size > maxBytes) {
      setImageAnalysisError("图片不能超过 5MB");
      return;
    }

    imageRequestRef.current?.abort();
    const requestId = imageRequestIdRef.current + 1;
    imageRequestIdRef.current = requestId;
    const controller = new AbortController();
    imageRequestRef.current = controller;

    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    const nextPreviewUrl = URL.createObjectURL(file);
    imagePreviewRef.current = nextPreviewUrl;
    touchedSinceUploadRef.current = {
      topic: false,
      platform: false,
      contentType: false,
      emotionTone: false,
    };
    setImagePreviewUrl(nextPreviewUrl);
    setImageAnalysis(null);
    setImageAnalysisError(null);
    setIsAnalyzing(true);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/analyze-image", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as
        | ImageAnalysisResult
        | { error?: string; message?: string }
        | null;

      if (requestId !== imageRequestIdRef.current) return;
      if (!response.ok) {
        const apiError = data as { error?: string; message?: string } | null;
        throw new Error(apiError?.message ?? "截图识别失败，请稍后重试");
      }

      const result = data as ImageAnalysisResult;
      setImageAnalysis(result);
      if (!touchedSinceUploadRef.current.topic) setTopic(result.topic);
      if (!touchedSinceUploadRef.current.platform) setPlatform(result.suggestedPlatform);
      if (!touchedSinceUploadRef.current.contentType) setContentType(result.suggestedContentType);
      if (!touchedSinceUploadRef.current.emotionTone) setEmotionTone(result.suggestedEmotionTone);
    } catch (caught) {
      if (controller.signal.aborted || requestId !== imageRequestIdRef.current) return;
      setImageAnalysisError(
        caught instanceof Error ? caught.message : "无法连接到图片识别服务，请稍后重试"
      );
    } finally {
      if (requestId === imageRequestIdRef.current) {
        imageRequestRef.current = null;
        setIsAnalyzing(false);
      }
    }
  }, []);

  const findHookContext = React.useCallback(
    (id: string) => {
      const currentHook = hooks.find((hook) => hook.id === id);
      if (currentHook) {
        return {
          hook: currentHook,
          platform: currentBatchContext?.platform ?? platform,
          contentType: currentBatchContext?.contentType ?? contentType,
          taskId: currentTaskId ?? currentBatchContext?.taskId,
        };
      }

      for (const item of history) {
        const historyHook = item.hooks.find((hook) => hook.id === id);
        if (historyHook) {
          return {
            hook: historyHook,
            platform: item.platform,
            contentType: item.contentType,
            taskId: item.taskId,
          };
        }
      }

      return null;
    },
    [contentType, currentBatchContext, currentTaskId, history, hooks, platform]
  );

  const openFeedback = React.useCallback(
    (request: Omit<CreatorFeedbackRequest, "promptId" | "anonymousCreatorId">) => {
      if (!anonymousCreatorId) return false;
      const promptId = createTaskId();
      const nextRequest: CreatorFeedbackRequest = {
        ...request,
        promptId,
        anonymousCreatorId,
      };
      track("creator_feedback", { ...nextRequest, status: "shown" });
      setFeedbackRequest(nextRequest);
      return true;
    },
    [anonymousCreatorId, track],
  );

  const performGenerate = React.useCallback(async () => {
    if (!topic.trim() || status === "loading" || isAnalyzing) return;

    const taskId = createTaskId();
    const generationPlatform = platform;
    const generationContentType = contentType;
    setCurrentTaskId(taskId);
    setStatus("loading");
    setError(null);
    setHooks([]);
    setAnalysis(null);
    const startedAt = Date.now();
    track("generation_start", {
      anonymousCreatorId,
      taskId,
      platform: generationPlatform,
      contentType: generationContentType,
    });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          platform: generationPlatform,
          contentType: generationContentType,
          targetAudience: targetAudience.trim() || undefined,
          emotionTone: emotionTone || undefined,
          wordLimit,
          imageDescription: imageAnalysis?.imageDescription,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError({ title: data.error ?? "生成失败", message: data.message ?? "未知错误" });
        setStatus("error");
        track("generation_error", { anonymousCreatorId, taskId, error: data.error ?? "生成失败" });
        return;
      }

      const response = data as GenerateResponse;
      const responseWithTask: GenerateResponse = { ...response, taskId };
      setHooks(response.hooks);
      setAnalysis(response.analysis ?? null);
      setCurrentBatchContext({
        taskId,
        platform: generationPlatform,
        contentType: generationContentType,
        templateVersion: response.templateVersion,
        promptVariant: response.promptVariant,
      });
      setStatus("done");
      addToHistory(responseWithTask);
      const avgScore =
        response.hooks.length > 0
          ? response.hooks.reduce((sum, hook) => sum + (hook.overallScore ?? hook.score ?? 0), 0) /
            response.hooks.length
          : 0;
      const avgClickScore =
        response.hooks.length > 0
          ? response.hooks.reduce((sum, hook) => sum + (hook.clickScore ?? 0), 0) /
            response.hooks.length
          : 0;
      track("generation_complete", {
        anonymousCreatorId,
        taskId,
        platform: generationPlatform,
        contentType: generationContentType,
        model: response.model,
        templateVersion: response.templateVersion,
        promptVariant: response.promptVariant,
        hookCount: response.hooks.length,
        avgScore,
        avgClickScore,
        durationMs: Date.now() - startedAt,
        badcaseTags: response.hooks.flatMap((hook) => hook.badcaseTags ?? []),
      });
    } catch {
      setError({
        title: "网络错误",
        message: "无法连接到服务器，请检查网络后重试",
      });
      setStatus("error");
      track("generation_error", { anonymousCreatorId, taskId, error: "网络错误" });
    }
  }, [
    topic,
    platform,
    contentType,
    targetAudience,
    emotionTone,
    wordLimit,
    imageAnalysis,
    isAnalyzing,
    status,
    addToHistory,
    anonymousCreatorId,
    track,
  ]);

  const handleGenerate = React.useCallback(() => {
    if (!topic.trim() || status === "loading" || isAnalyzing) return;

    const activeTaskId = currentBatchContext?.taskId ?? currentTaskId;
    const eligibleForSample =
      status === "done" &&
      hooks.length > 0 &&
      activeTaskId &&
      !hooks.some((hook) => hook.adopted) &&
      !hasDecisionFeedbackForTask(activeTaskId) &&
      !sampledTaskIdsRef.current.has(activeTaskId) &&
      shouldSampleFeedback(activeTaskId);

    if (eligibleForSample && activeTaskId) {
      sampledTaskIdsRef.current.add(activeTaskId);
      const representative = hooks[0];
      const opened = openFeedback({
        trigger: "sampled_before_regenerate",
        scope: "batch",
        taskId: activeTaskId,
        platform: currentBatchContext?.platform ?? platform,
        contentType: currentBatchContext?.contentType ?? contentType,
        templateVersion: currentBatchContext?.templateVersion ?? representative?.templateVersion,
        promptVariant: currentBatchContext?.promptVariant ?? representative?.promptVariant,
        modelBadcaseTags: [...new Set(hooks.flatMap((hook) => hook.badcaseTags ?? []))],
      });
      if (opened) return;
    }

    void performGenerate();
  }, [
    contentType,
    currentBatchContext,
    currentTaskId,
    hasDecisionFeedbackForTask,
    hooks,
    isAnalyzing,
    openFeedback,
    performGenerate,
    platform,
    status,
    topic,
  ]);

  const handleToggleFavorite = React.useCallback(
    (id: string) => {
      const willFavorite = !favorites.includes(id);
      const context = findHookContext(id);
      toggleFavorite(id);
      toggleHistoryFavorite(id);
      track(willFavorite ? "hook_favorited" : "hook_unfavorited", {
        anonymousCreatorId,
        taskId: context?.taskId,
        hookId: id,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
    },
    [anonymousCreatorId, favorites, findHookContext, toggleFavorite, toggleHistoryFavorite, track]
  );

  const handleToggleAdopted = React.useCallback(
    (id: string) => {
      const context = findHookContext(id);
      const current = context?.hook;
      const adopted = !current?.adopted;
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, adopted } : hook;
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, adopted }));
      track(adopted ? "hook_adopted" : "hook_unadopted", {
        anonymousCreatorId,
        taskId: context?.taskId,
        hookId: id,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
      if (adopted && context?.taskId) {
        openFeedback({
          trigger: "adoption",
          scope: "hook",
          taskId: context.taskId,
          hookId: id,
          platform: context.platform,
          contentType: context.contentType,
          templateVersion: context.hook.templateVersion,
          promptVariant: context.hook.promptVariant,
          clickScore: context.hook.clickScore,
          modelBadcaseTags: context.hook.badcaseTags,
        });
      }
    },
    [anonymousCreatorId, findHookContext, openFeedback, track, updateHook]
  );

  const handleSetSatisfaction = React.useCallback(
    (id: string, rating: PlatformSatisfaction) => {
      const update = (hook: HookResult): HookResult =>
        hook.id === id ? { ...hook, platformSatisfaction: rating } : hook;
      const context = findHookContext(id);
      const wasAlreadyLow = Boolean(
        context?.hook.platformSatisfaction && context.hook.platformSatisfaction <= 3,
      );
      setHooks((prev) => prev.map(update));
      updateHook(id, (hook) => ({ ...hook, platformSatisfaction: rating }));
      trackSatisfaction(id, rating, {
        anonymousCreatorId,
        taskId: context?.taskId,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: context?.hook.templateVersion,
        promptVariant: context?.hook.promptVariant,
        clickScore: context?.hook.clickScore,
      });
      if (rating <= 3 && !wasAlreadyLow && context?.taskId) {
        openFeedback({
          trigger: "low_satisfaction",
          scope: "hook",
          taskId: context.taskId,
          hookId: id,
          platform: context.platform,
          contentType: context.contentType,
          templateVersion: context.hook.templateVersion,
          promptVariant: context.hook.promptVariant,
          clickScore: context.hook.clickScore,
          modelBadcaseTags: context.hook.badcaseTags,
        });
      }
    },
    [anonymousCreatorId, findHookContext, openFeedback, trackSatisfaction, updateHook]
  );

  const handleCopyHook = React.useCallback(
    (hook: HookResult) => {
      const context = findHookContext(hook.id);
      track("hook_copied", {
        anonymousCreatorId,
        taskId: context?.taskId,
        hookId: hook.id,
        style: hook.style,
        platform: context?.platform,
        contentType: context?.contentType,
        templateVersion: hook.templateVersion,
        promptVariant: hook.promptVariant,
        clickScore: hook.clickScore,
      });
    },
    [anonymousCreatorId, findHookContext, track]
  );

  const handleRejectBatch = React.useCallback(() => {
    const taskId = currentBatchContext?.taskId ?? currentTaskId;
    if (!taskId) return;
    const representative = hooks[0];
    openFeedback({
      trigger: "explicit_batch_reject",
      scope: "batch",
      taskId,
      platform: currentBatchContext?.platform ?? platform,
      contentType: currentBatchContext?.contentType ?? contentType,
      templateVersion: currentBatchContext?.templateVersion ?? representative?.templateVersion,
      promptVariant: currentBatchContext?.promptVariant ?? representative?.promptVariant,
      modelBadcaseTags: [...new Set(hooks.flatMap((hook) => hook.badcaseTags ?? []))],
    });
  }, [contentType, currentBatchContext, currentTaskId, hooks, openFeedback, platform]);

  const handleFeedbackSkip = React.useCallback(() => {
    const request = feedbackRequest;
    if (!request) return;
    track("creator_feedback", { ...request, status: "skipped" });
    setFeedbackRequest(null);
    if (request.trigger === "sampled_before_regenerate") {
      window.setTimeout(() => void performGenerate(), 0);
    }
  }, [feedbackRequest, performGenerate, track]);

  const handleFeedbackSubmit = React.useCallback(
    (submission: CreatorFeedbackSubmission) => {
      const request = feedbackRequest;
      if (!request) return;
      const responseFields =
        submission.usageOutcome === "direct_use"
          ? { usageOutcome: submission.usageOutcome }
          : submission;
      track("creator_feedback", { ...request, status: "submitted", ...responseFields });
      setFeedbackRequest(null);
      if (request.trigger === "sampled_before_regenerate") {
        window.setTimeout(() => void performGenerate(), 0);
      }
    },
    [feedbackRequest, performGenerate, track],
  );

  return (
    <div className="min-h-screen">
      <AppHeader
        favoritesCount={favorites.length}
        historyCount={history.length}
        onOpenFavorites={() => setFavoritesOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {coachEnabled && (
        <nav aria-label="创作模式" className="mx-auto flex w-full max-w-7xl px-4 pt-5 md:px-6">
          <div className="inline-flex rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
            <button aria-pressed={mode === "classic"} className="choice-button control-base min-h-9 border-0 px-4 text-xs font-extrabold" onClick={() => setMode("classic")} type="button">经典生成</button>
            <button aria-pressed={mode === "coach"} className="choice-button control-base min-h-9 border-0 px-4 text-xs font-extrabold" onClick={() => setMode("coach")} type="button">创作 Agent</button>
          </div>
        </nav>
      )}

      {mode === "classic" ? (
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 pb-20 md:px-6 md:py-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <InputPanel
          contentType={contentType}
          emotionTone={emotionTone}
          imageAnalysis={imageAnalysis}
          imageAnalysisError={imageAnalysisError}
          imagePreviewUrl={imagePreviewUrl}
          isAnalyzing={isAnalyzing}
          onClearImage={handleClearImage}
          onGenerate={handleGenerate}
          onImageSelect={handleImageSelect}
          platform={platform}
          setContentType={handleContentTypeChange}
          setEmotionTone={handleEmotionToneChange}
          setPlatform={handlePlatformChange}
          setTargetAudience={setTargetAudience}
          setTopic={handleTopicChange}
          setWordLimit={setWordLimit}
          status={status}
          targetAudience={targetAudience}
          topic={topic}
          wordLimit={wordLimit}
        />

        <div aria-live="polite" className="min-w-0 space-y-4">
          {status === "idle" && (
            <section className="editorial-panel overflow-hidden">
              <div className="grid min-h-[430px] content-between p-5 sm:p-7">
                <div>
                  <p className="text-xs font-extrabold text-[var(--color-accent)]">你的候选区</p>
                  <h2 className="mt-4 max-w-[14ch] text-3xl font-black leading-[1.05] tracking-[-0.035em] sm:text-4xl">
                    从十个角度里，选出真正能用的一个。
                  </h2>
                  <p className="mt-4 max-w-[58ch] text-sm leading-6 text-[var(--color-graphite)]">
                    生成后，这里会先突出最佳候选，再列出其余版本。模型评分负责解释差异，收藏和采用记录由你决定。
                  </p>
                </div>
                <div className="mt-12 grid gap-px overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3">
                  {[
                    { icon: Copy, title: "快速比较", text: "同一主题一次查看 10 种表达。" },
                    { icon: Heart, title: "沉淀收藏", text: "把高价值 Hook 留作复用资产。" },
                    { icon: CheckCircle, title: "记录采用", text: "将真实选择反馈到运营复盘。" },
                  ].map(({ icon: Icon, title, text }) => (
                    <div className="bg-[var(--color-surface)] p-4" key={title}>
                      <Icon aria-hidden="true" className="text-[var(--color-accent)]" size={19} weight="bold" />
                      <h3 className="mt-3 text-sm font-extrabold">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {status === "loading" && <SkeletonCards />}

          {status === "error" && error && (
            <section className="editorial-panel p-5 sm:p-6" role="alert">
              <WarningCircle aria-hidden="true" className="text-[var(--color-danger)]" size={28} weight="fill" />
              <p className="mt-4 text-xs font-extrabold text-[var(--color-danger)]">生成未完成</p>
              <h2 className="mt-2 text-xl font-black">{error.title}</h2>
              <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-sm leading-6 text-[var(--color-graphite)]">
                {error.message}
              </p>
              <button className="button-secondary mt-5" onClick={handleGenerate} type="button">
                <ArrowClockwise aria-hidden="true" size={16} weight="bold" />
                重试生成
              </button>
            </section>
          )}

          {status === "done" && hooks.length > 0 && (
            <HookGrid
              analysis={analysis}
              favoritedIds={favorites}
              hooks={hooks}
              onCopyHook={handleCopyHook}
              onRejectBatch={handleRejectBatch}
              onSetSatisfaction={handleSetSatisfaction}
              onToggleAdopted={handleToggleAdopted}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {status === "done" && (
            <section aria-label="本地使用指标" className="editorial-panel grid grid-cols-2 overflow-hidden sm:grid-cols-4">
              {[
                { label: "生成完成率", value: `${stats.completionRate}%` },
                { label: "收藏率", value: `${stats.favoriteRate}%` },
                { label: "采用率", value: `${stats.adoptionRate}%` },
                { label: "平台适配", value: stats.avgPlatformSatisfaction ? `${stats.avgPlatformSatisfaction}/5` : "暂无" },
              ].map((item) => (
                <div className="border-b border-r border-[var(--color-line)] p-3.5 last:border-r-0 sm:border-b-0" key={item.label}>
                  <p className="text-[11px] font-bold text-[var(--color-muted)]">{item.label}</p>
                  <p className="mt-1 text-xl font-black tabular-nums">{item.value}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      </main>
      ) : (
        <CreativeCoachWorkspace onFinalized={handleCoachFinalized} track={track} />
      )}

      <HistoryDrawer
        history={history}
        loaded={historyLoaded}
        onClearAll={clearAll}
        onClose={() => setHistoryOpen(false)}
        onDelete={deleteHistory}
        onToggleFavorite={toggleHistoryFavorite}
        open={historyOpen}
      />
      <FavoritesDrawer
        favoritedIds={favorites}
        history={history}
        onClose={() => setFavoritesOpen(false)}
        onCopyHook={handleCopyHook}
        onSetSatisfaction={handleSetSatisfaction}
        onToggleAdopted={handleToggleAdopted}
        onToggleFavorite={handleToggleFavorite}
        open={favoritesOpen}
      />
      <CreatorFeedbackDialog
        key={feedbackRequest?.promptId ?? "feedback-closed"}
        onSkip={handleFeedbackSkip}
        onSubmit={handleFeedbackSubmit}
        request={feedbackRequest}
      />
    </div>
  );
}
