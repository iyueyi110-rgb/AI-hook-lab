"use client";

import { useState } from "react";
import type { Platform, ContentType, EmotionTone, GenerateStatus } from "@/lib/types";
import {
  CONTENT_TYPE_CONFIG,
  EMOTION_TONE_CONFIG,
  PLATFORM_CONFIG,
} from "@/lib/constants";

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

  return (
    <section className="mx-auto grid w-full max-w-5xl grid-cols-1 border-x border-b border-neutral-300 bg-white md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-7 px-4 py-6 md:px-6 md:py-8">
        <div>
          <label
            htmlFor="topic"
            className="mb-2 block text-xs font-bold uppercase text-neutral-500"
          >
            主题
          </label>
          <input
            id="topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && topic.trim() && !loading) {
                onGenerate();
              }
            }}
            placeholder="例如：AI 写周报、早起打卡、二手车避坑"
            className="w-full border border-neutral-300 bg-white px-4 py-4 text-base font-semibold text-[#111111] outline-none placeholder:text-neutral-400 focus:border-[#E4002B] md:text-xl"
            disabled={loading}
            autoFocus
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-neutral-500">
            平台
          </label>
          <div className="flex flex-wrap border-l border-t border-neutral-300">
            {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                disabled={loading}
                className={`min-h-12 basis-1/2 border-b border-r border-neutral-300 px-3 text-sm font-bold transition-colors sm:basis-1/5 ${
                  platform === p
                    ? "bg-[#E4002B] text-white"
                    : "bg-white text-[#111111] hover:bg-neutral-100"
                } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                {PLATFORM_CONFIG[p].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-neutral-500">
            内容类型
          </label>
          <div className="flex flex-wrap border-l border-t border-neutral-300">
            {(Object.keys(CONTENT_TYPE_CONFIG) as ContentType[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setContentType(c)}
                disabled={loading}
                className={`min-h-12 basis-1/2 border-b border-r border-neutral-300 px-3 text-sm font-bold transition-colors sm:basis-1/5 ${
                  contentType === c
                    ? "bg-[#E4002B] text-white"
                    : "bg-white text-[#111111] hover:bg-neutral-100"
                } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                {CONTENT_TYPE_CONFIG[c].label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-300 pt-5">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="text-sm font-bold text-[#111111] underline decoration-[#E4002B] decoration-2 underline-offset-4 transition-colors hover:text-[#E4002B]"
            disabled={loading}
          >
            {advancedOpen ? "收起高级选项" : "展开高级选项"}
          </button>

          {advancedOpen && (
            <div className="mt-5 space-y-5">
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
                  className="w-full border border-neutral-300 bg-white px-4 py-3 text-sm text-[#111111] outline-none placeholder:text-neutral-400 focus:border-[#E4002B]"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-neutral-500">
                  情绪风格
                </label>
                <div className="flex flex-wrap gap-px bg-neutral-300">
                  <button
                    type="button"
                    onClick={() => setEmotionTone("")}
                    disabled={loading}
                    className={`min-h-9 px-3 text-xs font-bold transition-colors ${
                      emotionTone === ""
                        ? "bg-[#E4002B] text-white"
                        : "bg-white text-[#111111] hover:bg-neutral-100"
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
                      className={`min-h-9 px-3 text-xs font-bold transition-colors ${
                        emotionTone === tone
                          ? "bg-[#E4002B] text-white"
                          : "bg-white text-[#111111] hover:bg-neutral-100"
                      } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                    >
                      {EMOTION_TONE_CONFIG[tone].label}
                    </button>
                  ))}
                </div>
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
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onGenerate}
          disabled={!topic.trim() || loading}
          className={`w-full border border-[#111111] px-6 py-4 text-sm font-black uppercase transition-colors ${
            topic.trim() && !loading
              ? "bg-[#111111] text-white hover:bg-[#E4002B]"
              : "cursor-not-allowed bg-neutral-200 text-neutral-500"
          }`}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              正在生成 10 个 Hook
            </span>
          ) : (
            "生成 10 个 Hook"
          )}
        </button>
      </div>

      <aside className="border-t border-neutral-300 p-4 md:border-l md:border-t-0 md:p-6">
        <p className="mb-6 text-xs font-bold uppercase text-neutral-500">
          当前配置
        </p>
        <dl className="space-y-5">
          <div>
            <dt className="text-xs font-bold text-neutral-500">平台</dt>
            <dd className="mt-1 text-2xl font-black leading-none text-[#111111]">
              {PLATFORM_CONFIG[platform].label}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-neutral-500">类型</dt>
            <dd className="mt-1 text-2xl font-black leading-none text-[#111111]">
              {CONTENT_TYPE_CONFIG[contentType].label}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-neutral-500">字数</dt>
            <dd className="mt-1 text-2xl font-black leading-none text-[#E4002B]">
              {wordLimit}
            </dd>
          </div>
        </dl>
      </aside>
    </section>
  );
}
