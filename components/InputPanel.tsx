"use client";

import type { Platform, ContentType, GenerateStatus } from "@/lib/types";
import { PLATFORM_CONFIG, CONTENT_TYPE_CONFIG } from "@/lib/constants";

interface InputPanelProps {
  topic: string;
  setTopic: (v: string) => void;
  platform: Platform;
  setPlatform: (p: Platform) => void;
  contentType: ContentType;
  setContentType: (c: ContentType) => void;
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
  status,
  onGenerate,
}: InputPanelProps) {
  const loading = status === "loading";

  return (
    <section className="w-full max-w-2xl mx-auto space-y-6 px-4 md:px-0">
      {/* Topic input */}
      <div>
        <label
          htmlFor="topic"
          className="block text-sm font-medium text-gray-700 mb-2"
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
          placeholder="例如：AI 写周报、早起打卡、二手车避坑…"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none"
          disabled={loading}
          autoFocus
        />
      </div>

      {/* Platform selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          平台
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                platform === p
                  ? "bg-violet-600 text-white shadow-sm"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-transparent hover:border-gray-200"
              } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span>{PLATFORM_CONFIG[p].emoji}</span>
              <span className="hidden sm:inline">{PLATFORM_CONFIG[p].label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content type selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          内容类型
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CONTENT_TYPE_CONFIG) as ContentType[]).map((c) => (
            <button
              key={c}
              onClick={() => setContentType(c)}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                contentType === c
                  ? "bg-violet-600 text-white shadow-sm"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-transparent hover:border-gray-200"
              } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span>{CONTENT_TYPE_CONFIG[c].icon}</span>
              <span>{CONTENT_TYPE_CONFIG[c].label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={!topic.trim() || loading}
        className={`w-full rounded-xl px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all ${
          topic.trim() && !loading
            ? "bg-violet-600 hover:bg-violet-700 active:scale-[0.99] cursor-pointer"
            : "bg-gray-300 cursor-not-allowed"
        }`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
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
            正在生成 {10} 个 Hook...
          </span>
        ) : (
          `生成 ${10} 个 Hook`
        )}
      </button>
    </section>
  );
}
