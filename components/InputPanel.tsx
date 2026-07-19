"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  Camera,
  CaretDown,
  MagicWand,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import type {
  ContentType,
  EmotionTone,
  GenerateStatus,
  ImageAnalysisResult,
  Platform,
} from "@/lib/types";
import {
  CONTENT_TYPE_CONFIG,
  EMOTION_TONE_CONFIG,
  PLATFORM_CONFIG,
} from "@/lib/constants";
import { MAX_TOPIC_LENGTH } from "@/lib/promptTemplates";

interface InputPanelProps {
  topic: string;
  setTopic: (v: string) => void;
  platform: Platform;
  setPlatform: (p: Platform) => void;
  contentType: ContentType;
  setContentType: (c: ContentType) => void;
  targetAudience: string;
  setTargetAudience: (v: string) => void;
  emotionTone: EmotionTone | "";
  setEmotionTone: (e: EmotionTone | "") => void;
  wordLimit: number;
  setWordLimit: (n: number) => void;
  status: GenerateStatus;
  onGenerate: () => void;
  imagePreviewUrl: string | null;
  imageAnalysis: ImageAnalysisResult | null;
  isAnalyzing: boolean;
  imageAnalysisError: string | null;
  onImageSelect: (file: File) => void;
  onClearImage: () => void;
}

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label className="mb-2 block text-xs font-extrabold text-[var(--color-ink)]" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function InputPanel({
  topic,
  setTopic,
  platform,
  setPlatform,
  contentType,
  setContentType,
  targetAudience,
  setTargetAudience,
  emotionTone,
  setEmotionTone,
  wordLimit,
  setWordLimit,
  status,
  onGenerate,
  imagePreviewUrl,
  imageAnalysis,
  isAnalyzing,
  imageAnalysisError,
  onImageSelect,
  onClearImage,
}: InputPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageInputId = useId();
  const platformLabelId = useId();
  const contentLabelId = useId();
  const emotionLabelId = useId();
  const loading = status === "loading";
  const canGenerate = topic.trim().length > 0 && !loading && !isAnalyzing;

  const selectFile = (file?: File) => {
    if (file && !loading) onImageSelect(file);
  };

  return (
    <aside className="editorial-panel overflow-hidden lg:sticky lg:top-24">
      <div className="border-b border-[var(--color-line)] p-5 md:p-6">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--color-accent)]">
          <MagicWand aria-hidden="true" size={16} weight="bold" />
          创作简报
        </div>
        <h1 className="mt-4 max-w-[11ch] text-[2.2rem] font-black leading-[0.98] tracking-[-0.035em] text-balance sm:text-[2.55rem] lg:text-[2.25rem]">
          写出能停住手指的开头。
        </h1>
        <p className="mt-3 max-w-[46ch] text-sm leading-6 text-[var(--color-graphite)]">
          给出主题与平台，生成 10 个可比较、可复用的 Hook 候选。
        </p>
      </div>

      <div className="space-y-5 p-5 md:p-6">
        <div>
          <FieldLabel htmlFor={imageInputId}>内容截图（可选）</FieldLabel>
          <div
            className={`relative overflow-hidden rounded-[10px] border border-dashed transition-colors ${
              dragActive
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-line-strong)] bg-[var(--color-canvas)]"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!loading) setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              selectFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={loading}
              id={imageInputId}
              onChange={(event) => {
                selectFile(event.target.files?.[0]);
                event.target.value = "";
              }}
              ref={imageInputRef}
              type="file"
            />
            <label
              aria-label={imagePreviewUrl ? "更换内容截图" : "上传内容截图"}
              className="block cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset"
              htmlFor={imageInputId}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  imageInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={loading ? -1 : 0}
            >
              {imagePreviewUrl ? (
                <div className="grid min-h-28 grid-cols-[92px_1fr] items-center gap-3 p-3 pr-11">
                  <Image
                    alt="待识别的内容截图预览"
                    className="h-24 w-[92px] rounded-md border border-[var(--color-line)] object-cover"
                    height={96}
                    src={imagePreviewUrl}
                    unoptimized
                    width={92}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold text-[var(--color-accent)]">
                      {isAnalyzing ? "正在识别…" : imageAnalysis ? "截图已识别" : "截图待处理"}
                    </p>
                    <p className="mt-1 line-clamp-3 text-sm font-bold leading-5 text-[var(--color-ink)]">
                      {imageAnalysis?.topic ?? "豆包将自动提取主题与创作建议"}
                    </p>
                    {!isAnalyzing && (
                      <p className="mt-2 text-[11px] text-[var(--color-muted)]">点击或拖拽可替换</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-28 flex-col items-center justify-center px-4 py-5 text-center">
                  <Camera aria-hidden="true" className="text-[var(--color-accent)]" size={24} weight="bold" />
                  <p className="mt-2 text-sm font-extrabold">上传内容截图，自动识别主题</p>
                  <p className="mt-1 text-[11px] text-[var(--color-muted)]">JPEG、PNG 或 WebP，最大 5MB</p>
                </div>
              )}
            </label>

            {imagePreviewUrl && (
              <button
                aria-label="清除内容截图"
                className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-graphite)] shadow-sm hover:text-[var(--color-accent)]"
                disabled={loading}
                onClick={onClearImage}
                type="button"
              >
                <X aria-hidden="true" size={15} weight="bold" />
              </button>
            )}

            {imagePreviewUrl && isAnalyzing && (
              <div className="soft-pulse pointer-events-none absolute inset-0 grid place-items-center bg-[var(--color-surface)]/80">
                <span className="rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs font-extrabold text-white">
                  正在识别…
                </span>
              </div>
            )}
          </div>
          {imageAnalysisError && (
            <p className="mt-2 text-xs font-semibold leading-5 text-[var(--color-danger)]" role="alert">
              {imageAnalysisError}
            </p>
          )}
          <p className="mt-2 text-[10px] leading-4 text-[var(--color-muted)]">
            图片会发送至豆包识别，文字描述将用于 DeepSeek 生成；原图不会保存。
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="topic">主题</FieldLabel>
          <div className="relative">
            <textarea
              autoFocus
              className="control-base min-h-24 w-full resize-none px-3.5 py-3 pr-14 text-sm font-semibold leading-6 placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
              disabled={loading}
              id="topic"
              maxLength={MAX_TOPIC_LENGTH}
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate) {
                  onGenerate();
                }
              }}
              placeholder="例如：AI 写周报、早起打卡、二手车避坑"
              value={topic}
            />
            <span className="absolute bottom-2.5 right-3 text-[11px] font-semibold tabular-nums text-[var(--color-muted)]">
              {topic.length}/{MAX_TOPIC_LENGTH}
            </span>
          </div>
        </div>

        <fieldset aria-labelledby={platformLabelId}>
          <legend className="mb-2 text-xs font-extrabold" id={platformLabelId}>
            发布平台
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2">
            {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((item) => {
              const selected = platform === item;
              return (
                <button
                  aria-pressed={selected}
                  className="choice-button control-base relative min-h-10 px-3 text-xs font-bold"
                  disabled={loading}
                  key={item}
                  onClick={() => setPlatform(item)}
                  type="button"
                >
                  {PLATFORM_CONFIG[item].label}
                  {imageAnalysis?.suggestedPlatform === item && (
                    <span className="absolute right-1 top-1 text-[9px] font-black text-[var(--color-accent)]">荐</span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset aria-labelledby={contentLabelId}>
          <legend className="mb-2 text-xs font-extrabold" id={contentLabelId}>
            内容类型
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2">
            {(Object.keys(CONTENT_TYPE_CONFIG) as ContentType[]).map((item) => {
              const selected = contentType === item;
              return (
                <button
                  aria-pressed={selected}
                  className="choice-button control-base relative min-h-10 px-3 text-xs font-bold"
                  disabled={loading}
                  key={item}
                  onClick={() => setContentType(item)}
                  type="button"
                >
                  {CONTENT_TYPE_CONFIG[item].label}
                  {imageAnalysis?.suggestedContentType === item && (
                    <span className="absolute right-1 top-1 text-[9px] font-black text-[var(--color-accent)]">荐</span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="border-t border-[var(--color-line)] pt-4">
          <button
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-3 text-left text-xs font-extrabold text-[var(--color-graphite)] hover:text-[var(--color-ink)]"
            disabled={loading}
            onClick={() => setAdvancedOpen((open) => !open)}
            type="button"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal aria-hidden="true" size={16} weight="bold" />
              高级选项
            </span>
            <CaretDown
              aria-hidden="true"
              className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              size={15}
              weight="bold"
            />
          </button>

          {advancedOpen && (
            <div className="mt-4 space-y-4">
              <div>
                <FieldLabel htmlFor="target-audience">目标用户</FieldLabel>
                <input
                  className="control-base h-11 w-full px-3.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
                  disabled={loading}
                  id="target-audience"
                  onChange={(event) => setTargetAudience(event.target.value)}
                  placeholder="例如：新手产品经理"
                  type="text"
                  value={targetAudience}
                />
              </div>

              <div>
                <FieldLabel htmlFor="word-limit">
                  字数限制 <span className="text-[var(--color-accent)]">{wordLimit} 字</span>
                </FieldLabel>
                <input
                  className="w-full accent-[var(--color-accent)]"
                  disabled={loading}
                  id="word-limit"
                  max={150}
                  min={30}
                  onChange={(event) => setWordLimit(Number(event.target.value))}
                  step={10}
                  type="range"
                  value={wordLimit}
                />
                <div className="mt-1 flex justify-between text-[11px] text-[var(--color-muted)]">
                  <span>30</span>
                  <span>150</span>
                </div>
              </div>

              <fieldset aria-labelledby={emotionLabelId}>
                <legend className="mb-2 text-xs font-extrabold" id={emotionLabelId}>
                  情绪风格
                </legend>
                <div className="flex flex-wrap gap-2">
                  <button
                    aria-pressed={emotionTone === ""}
                    className="choice-button control-base min-h-9 px-3 text-xs font-bold"
                    disabled={loading}
                    onClick={() => setEmotionTone("")}
                    type="button"
                  >
                    自动
                  </button>
                  {(Object.keys(EMOTION_TONE_CONFIG) as EmotionTone[]).map((tone) => (
                    <button
                      aria-pressed={emotionTone === tone}
                      className="choice-button control-base relative min-h-9 px-3 text-xs font-bold"
                      disabled={loading}
                      key={tone}
                      onClick={() => setEmotionTone(tone)}
                      title={EMOTION_TONE_CONFIG[tone].description}
                      type="button"
                    >
                      {EMOTION_TONE_CONFIG[tone].label}
                      {imageAnalysis?.suggestedEmotionTone === tone && (
                        <span className="absolute right-1 top-0.5 text-[9px] font-black text-[var(--color-accent)]">荐</span>
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        <button
          className="button-primary w-full"
          disabled={!canGenerate}
          onClick={onGenerate}
          type="button"
        >
          <MagicWand aria-hidden="true" size={18} weight="bold" />
          {loading ? "正在生成 10 个 Hook" : "生成 10 个 Hook"}
        </button>
        <p className="text-center text-[11px] leading-4 text-[var(--color-muted)]">
          按 Ctrl / ⌘ + Enter 快速生成
        </p>
      </div>
    </aside>
  );
}
