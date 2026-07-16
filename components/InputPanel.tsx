"use client";

import { useId, useState, type ReactNode } from "react";
import {
  CaretDown,
  MagicWand,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import type {
  ContentType,
  EmotionTone,
  GenerateStatus,
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
}: InputPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const platformLabelId = useId();
  const contentLabelId = useId();
  const emotionLabelId = useId();
  const loading = status === "loading";
  const canGenerate = topic.trim().length > 0 && !loading;

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
                  className={`control-base min-h-10 px-3 text-xs font-bold ${
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-ink)]"
                  }`}
                  disabled={loading}
                  key={item}
                  onClick={() => setPlatform(item)}
                  type="button"
                >
                  {PLATFORM_CONFIG[item].label}
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
                  className={`control-base min-h-10 px-3 text-xs font-bold ${
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-ink)]"
                  }`}
                  disabled={loading}
                  key={item}
                  onClick={() => setContentType(item)}
                  type="button"
                >
                  {CONTENT_TYPE_CONFIG[item].label}
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
                    className={`control-base min-h-9 px-3 text-xs font-bold ${
                      emotionTone === ""
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : ""
                    }`}
                    disabled={loading}
                    onClick={() => setEmotionTone("")}
                    type="button"
                  >
                    自动
                  </button>
                  {(Object.keys(EMOTION_TONE_CONFIG) as EmotionTone[]).map((tone) => (
                    <button
                      aria-pressed={emotionTone === tone}
                      className={`control-base min-h-9 px-3 text-xs font-bold ${
                        emotionTone === tone
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : ""
                      }`}
                      disabled={loading}
                      key={tone}
                      onClick={() => setEmotionTone(tone)}
                      title={EMOTION_TONE_CONFIG[tone].description}
                      type="button"
                    >
                      {EMOTION_TONE_CONFIG[tone].label}
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
