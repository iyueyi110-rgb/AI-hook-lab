"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Platform, ContentType, EmotionTone, GenerateStatus } from "@/lib/types";
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

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm font-black text-[#111111]">
      <span className="h-5 w-1 rounded-full bg-[#E4002B]" />
      {children}
    </label>
  );
}

function ConfigItem({
  label,
  value,
  mark,
}: {
  label: string;
  value: string;
  mark: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-neutral-200 bg-neutral-50 text-base font-black text-[#E4002B] shadow-sm">
        {mark}
      </div>
      <div>
        <p className="text-xs font-semibold text-neutral-500">{label}</p>
        <p className="mt-1 text-base font-black text-[#111111]">{value}</p>
      </div>
    </div>
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
  const loading = status === "loading";
  const canGenerate = topic.trim().length > 0 && !loading;

  return (
    <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 md:grid-cols-[minmax(0,1fr)_320px] md:px-2">
      <div className="rounded-[18px] border border-neutral-200 bg-white p-5 shadow-[0_18px_60px_rgba(17,17,17,0.08)] md:p-6">
        <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-[#E4002B]">
          AI Hook Lab
        </p>
        <h1 className="max-w-4xl text-4xl font-black leading-[0.96] tracking-tight text-[#111111] md:text-5xl">
          写出能<span className="text-[#E4002B]">停住手指</span>的开头。
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 md:text-base">
          输入主题，选择发布平台和内容类型，一次生成 10 个不同角度的 Hook，并保留可复用的评分与记录。
        </p>

        <div className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_10px_36px_rgba(17,17,17,0.06)]">
          <div>
            <FieldLabel>主题</FieldLabel>
            <div className="relative">
              <input
                id="topic"
                type="text"
                value={topic}
                maxLength={MAX_TOPIC_LENGTH}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canGenerate) onGenerate();
                }}
                placeholder="例如：AI 写周报、早起打卡、二手车避坑"
                className="min-h-14 w-full rounded-xl border border-[#E4002B] bg-white px-5 py-3 pr-20 text-base font-semibold text-[#111111] outline-none placeholder:text-neutral-400 focus:ring-4 focus:ring-[#E4002B]/10"
                disabled={loading}
                autoFocus
              />
              <span className="absolute bottom-3 right-4 text-xs font-semibold text-neutral-400">
                {topic.length} / {MAX_TOPIC_LENGTH}
              </span>
            </div>
          </div>

          <div className="mt-4">
            <FieldLabel>选择平台</FieldLabel>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  disabled={loading}
                  className={`relative min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                    platform === p
                      ? "border-[#E4002B] bg-[#E4002B]/5 text-[#111111] shadow-[0_8px_20px_rgba(228,0,43,0.08)]"
                      : "border-neutral-200 bg-white text-[#111111] hover:border-[#E4002B]"
                  } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {p === "xiaohongshu" && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#E4002B] px-3 py-1 text-[10px] font-black text-white">
                      推荐
                    </span>
                  )}
                  {PLATFORM_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <FieldLabel>内容类型</FieldLabel>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {(Object.keys(CONTENT_TYPE_CONFIG) as ContentType[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setContentType(c)}
                  disabled={loading}
                  className={`min-h-10 rounded-lg border px-3 text-sm font-black transition ${
                    contentType === c
                      ? "border-[#E4002B] bg-[#E4002B]/5 text-[#E4002B]"
                      : "border-neutral-200 bg-white text-[#111111] hover:border-[#E4002B]"
                  } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {CONTENT_TYPE_CONFIG[c].label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-neutral-200 pt-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 transition hover:text-[#E4002B]"
              disabled={loading}
            >
              {advancedOpen ? "收起高级选项" : "展开高级选项"}
            </button>

            {advancedOpen && (
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="target-audience"
                    className="mb-2 block text-xs font-bold uppercase text-neutral-500"
                  >
                    目标用户
                  </label>
                  <input
                    id="target-audience"
                    type="text"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="例如：25-35岁职场女性、大学生、新手宝妈"
                    className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-[#111111] outline-none placeholder:text-neutral-400 focus:border-[#E4002B] focus:ring-4 focus:ring-[#E4002B]/10"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label
                    htmlFor="word-limit"
                    className="mb-2 block text-xs font-bold uppercase text-neutral-500"
                  >
                    字数限制：<span className="text-[#E4002B]">{wordLimit}</span> 字
                  </label>
                  <input
                    id="word-limit"
                    type="range"
                    min={30}
                    max={150}
                    step={10}
                    value={wordLimit}
                    onChange={(e) => setWordLimit(Number(e.target.value))}
                    disabled={loading}
                    className="w-full accent-[#E4002B]"
                  />
                  <div className="mt-1 flex justify-between text-xs text-neutral-500">
                    <span>30</span>
                    <span>150</span>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-xs font-bold uppercase text-neutral-500">
                    情绪风格
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEmotionTone("")}
                      disabled={loading}
                      className={`min-h-9 rounded-lg border px-3 text-xs font-bold transition ${
                        emotionTone === ""
                          ? "border-[#E4002B] bg-[#E4002B] text-white"
                          : "border-neutral-200 bg-white text-[#111111] hover:border-[#E4002B]"
                      } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                    >
                      自动
                    </button>
                    {(Object.keys(EMOTION_TONE_CONFIG) as EmotionTone[]).map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => setEmotionTone(tone)}
                        disabled={loading}
                        title={EMOTION_TONE_CONFIG[tone].description}
                        className={`min-h-9 rounded-lg border px-3 text-xs font-bold transition ${
                          emotionTone === tone
                            ? "border-[#E4002B] bg-[#E4002B] text-white"
                            : "border-neutral-200 bg-white text-[#111111] hover:border-[#E4002B]"
                        } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      >
                        {EMOTION_TONE_CONFIG[tone].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className={`mt-4 w-full rounded-lg px-6 py-3.5 text-sm font-black uppercase tracking-wide text-white transition ${
              canGenerate
                ? "bg-[#E4002B] shadow-[0_14px_30px_rgba(228,0,43,0.22)] hover:bg-[#B80022]"
                : "cursor-not-allowed bg-[#E4002B] opacity-35"
            }`}
          >
            {loading ? "正在生成 10 个 Hook" : "生成 10 个 Hook"}
          </button>
        </div>
      </div>

      <aside className="rounded-[18px] border border-neutral-200 bg-white p-7 shadow-[0_18px_60px_rgba(17,17,17,0.08)] md:min-h-[500px]">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#E4002B]">
          Output
        </p>
        <p className="mt-8 text-sm font-semibold text-neutral-500">将为你生成</p>
        <p className="mt-2 text-[6.25rem] font-black leading-none tracking-tight text-[#E4002B]">
          10
        </p>
        <p className="mt-2 text-base font-semibold text-neutral-500">
          个不同角度的 Hook
        </p>

        <div className="my-9 h-px bg-neutral-200" />

        <p className="mb-6 text-sm font-black text-[#111111]">当前配置</p>
        <div className="space-y-7">
          <ConfigItem label="平台" value={PLATFORM_CONFIG[platform].label} mark="P" />
          <ConfigItem label="类型" value={CONTENT_TYPE_CONFIG[contentType].label} mark="T" />
          <ConfigItem label="字数" value={`${wordLimit} 字左右`} mark="Aa" />
        </div>
      </aside>
    </section>
  );
}
