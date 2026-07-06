# AI Hook Lab 优化执行指令 v3

## 执行前必读

1. **先读完现有代码再动手。** 每个文件在修改前必须先 Read。
2. **每完成一个 Phase 跑一次 `npm run build`**，确认零 TS 错误再进入下一 Phase。
3. **不删除 localStorage 旧数据，只做读取兼容。** 旧数据格式 `{ score: number }` 不能崩。
4. **不引入新依赖。** 只用项目已有的 next/react/typescript/tailwind。
5. **不改 CSS。** globals.css / tailwind 配置不动。
6. **不改这些文件：** `Header.tsx` `SkeletonCards.tsx` `layout.tsx` `next.config.ts` `tsconfig.json` `package.json`

---

## 改动范围总览

| Phase | 文件 | 操作 | 改动量 |
|-------|------|------|--------|
| P1 | `lib/types.ts` | ✏️ 重写 | 小 |
| P1 | `lib/constants.ts` | ✏️ 末尾追加 | 小 |
| P1 | `app/api/generate/route.ts` | ✏️ 重写核心逻辑 | 大 |
| P2 | `components/InputPanel.tsx` | ✏️ 新增高级选项区 | 中 |
| P2 | `components/HookCard.tsx` | ✏️ 评分条改造 | 中 |
| P2 | `components/HookGrid.tsx` | ✏️ 新增 analysis 卡片 | 小 |
| P2 | `components/HistoryDrawer.tsx` | ✏️ 1 行兼容修复 | 极小 |
| P2 | `components/FavoritesDrawer.tsx` | ✏️ 1 行兼容修复 | 极小 |
| P2 | `app/page.tsx` | ✏️ 新增 state + 传参 | 中 |
| P3 | `hooks/useAnalytics.ts` | ➕ 新建 | 中 |
| P4 | `eval/*` (5个文件) | ➕ 新建 | 中 |
| P4 | `README.md` | ✏️ 新增产品复盘章节 | 小 |

---

## Phase 1：类型 + 常量 + API

### 1.1 `lib/types.ts` — 完整替换

```ts
export type Platform = "xiaohongshu" | "douyin" | "bilibili" | "youtube" | "x";

export type ContentType = "video" | "image-text" | "product-ad" | "tutorial" | "opinion";

export type EmotionTone =
  | "urgent"
  | "curious"
  | "humorous"
  | "emotional"
  | "authoritative"
  | "rebellious";

export type GenerateStatus = "idle" | "loading" | "done" | "error";

export interface HookScores {
  impact: number;
  platformFit: number;
  actionability: number;
  shareability: number;
}

export interface HookResult {
  id: string;
  text: string;
  style: string;
  reasoning: string;
  scores: HookScores;
  overallScore: number;
  badcaseTags?: string[];
  // 兼容旧数据
  score?: number;
}

export interface GenerateResponse {
  hooks: HookResult[];
  generatedAt: string;
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience?: string;
  emotionTone?: EmotionTone | "";
  wordLimit?: number;
  analysis?: {
    bestStyle: string;
    commonPattern: string;
    improvementTip: string;
  };
}

export interface HistoryItem extends GenerateResponse {
  id: string;
  isFavorited: boolean;
}

export interface GenerateRequest {
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience?: string;
  emotionTone?: EmotionTone | "";
  wordLimit?: number;
}
```

### 1.2 `lib/constants.ts` — 在文件末尾追加（不删不改现有代码）

在最后的 `STYLE_COLORS` 导出之后追加：

```ts
import type { EmotionTone } from "./types";

export const EMOTION_TONE_CONFIG: Record<
  EmotionTone,
  { label: string; icon: string; description: string }
> = {
  urgent:     { label: "紧迫感",   icon: "⚡", description: "制造立即行动的时间压力" },
  curious:    { label: "好奇心",   icon: "🔍", description: "制造信息缺口，引导继续阅读" },
  humorous:   { label: "幽默",     icon: "😄", description: "用轻松反差降低阅读门槛" },
  emotional:  { label: "情绪共鸣", icon: "💭", description: "强调用户身份与真实感受" },
  authoritative: { label: "权威",  icon: "📌", description: "突出经验、方法论和可信度" },
  rebellious: { label: "反常识",   icon: "🔥", description: "通过反直觉观点制造讨论欲" },
};
```

### 1.3 `app/api/generate/route.ts` — 重写核心逻辑

**保留不动：**
- `DEEPSEEK_BASE`、API Key 读取、30s AbortController、401/429/504 错误处理
- `generateId()` 函数
- JSON 解析 + markdown 代码块兜底逻辑
- `POST` 函数外层 try/catch 结构

**需要改写的 5 个部分：**

#### A. System Prompt

```ts
function buildSystemPrompt(): string {
  return `你是一位社交媒体文案策略师，擅长为不同平台创作高点击率的 Hook 开头。

## 好 Hook 的四条标准
1. **前3秒钩子**：开头 15 字内制造好奇心缺口、认知冲突或情绪共振
2. **平台原生感**：读起来像该平台原生创作者的内容，不是翻译腔或通用文案
3. **可操作性**：读者能清晰预期后续内容的价值和方向
4. **传播基因**：包含可被截图、引用、转发的"金句"元素

## 四维评分标准（每维 1-10 分）
- **impact（冲击力）**：前几个字是否制造了足够的认知缺口或情绪张力
- **platformFit（平台匹配度）**：语气、节奏、用词是否符合该平台调性
- **actionability（可操作性）**：读者是否能清晰预期后续内容价值
- **shareability（传播力）**：是否包含适合截图/引用的表达

## 输出要求
- 纯 JSON，不要 Markdown 包裹，不要额外文字
- reasoning 必须具体到词句层面，例如"开头'做了3年'用具体数字建立信任，'我才明白'制造反转预期"
- 禁止使用"运用了XX手法吸引了用户"这类模板化套话`;
}
```

#### B. User Prompt

```ts
function buildUserPrompt(req: GenerateRequest, platformLabel: string, platformDesc: string, contentTypeLabel: string, styles: string[]): string {
  const { topic, targetAudience, emotionTone, wordLimit } = req;
  const toneInstruction = emotionTone
    ? `\n**情绪风格：** ${emotionTone} — ${EMOTION_TONE_CONFIG[emotionTone as EmotionTone]?.description ?? ""}`
    : "";

  return `## 输入变量

**主题：** ${topic}
**平台：** ${platformLabel}（${platformDesc}）
**内容类型：** ${contentTypeLabel}
**目标用户：** ${targetAudience || "该平台泛用户群体"}${toneInstruction}
**字数限制：** 每条 Hook 不超过 ${wordLimit ?? 80} 字

## 平台风格池（每种风格生成一个 Hook，共 10 个）

${styles.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## 输出 JSON 格式
{
  "hooks": [
    {
      "text": "Hook 文案",
      "style": "风格名称（必须从风格池中取）",
      "reasoning": "具体到词句的引爆原理分析（30-60字）",
      "scores": { "impact": 8, "platformFit": 7, "actionability": 6, "shareability": 5 },
      "overallScore": 7
    }
  ],
  "analysis": {
    "bestStyle": "这批中表现最好的风格",
    "commonPattern": "这批 Hook 的共性规律（一句话）",
    "improvementTip": "如果效果不理想，可以尝试的调整方向"
  }
}

## 硬约束
- hooks 必须恰好 10 个，每个风格只用一次
- text 控制在规定字数以内
- overallScore 是四个维度的加权综合（整数 1-10）
- reasoning 必须引用具体词句，禁止模板套话
- 只返回 JSON`;
}
```

#### C. 分数归一化

```ts
function normalizeScores(raw: Record<string, unknown>): HookScores {
  const clamp = (v: unknown): number => {
    const n = Number(v);
    return isNaN(n) ? 7 : Math.max(1, Math.min(10, Math.round(n)));
  };
  return {
    impact: clamp(raw.impact),
    platformFit: clamp(raw.platformFit),
    actionability: clamp(raw.actionability),
    shareability: clamp(raw.shareability),
  };
}
```

#### D. Badcase 检测

```ts
function detectBadcases(hook: { text: string; reasoning: string; style: string; wordLimit: number }): string[] {
  const tags: string[] = [];

  // 字数异常（超过限制 20%）
  if (hook.text.length > hook.wordLimit * 1.2) tags.push("too_long");
  if (hook.text.length < 8) tags.push("too_short");

  // 标题党
  if (/震惊|不看后悔|全网都在|炸裂|颠覆认知|彻底改变/.test(hook.text)) tags.push("clickbait_risk");

  // 泛化词过多（出现 2 个以上）
  const genericWords = /干货满满|值得收藏|快速提升|太绝了|绝绝子|yyds|一定要看|超级好用/gi;
  const matches = hook.text.match(genericWords);
  if (matches && matches.length >= 2) tags.push("too_generic");

  // 理由空泛（短于 12 个中文字符）
  const chineseChars = hook.reasoning.match(/[一-鿿]/g);
  if (!chineseChars || chineseChars.length < 12) tags.push("weak_reasoning");

  return tags;
}
```

#### E. validateAndCleanHooks 重写

```ts
function validateAndCleanHooks(raw: unknown, wordLimit: number): { hooks: HookResult[]; analysis?: GenerateResponse["analysis"] } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid JSON response from AI");

  const obj = raw as Record<string, unknown>;
  const rawHooks = obj.hooks;
  if (!Array.isArray(rawHooks) || rawHooks.length === 0) throw new Error("AI 返回的 hooks 为空或格式错误");

  const hooks: HookResult[] = rawHooks.slice(0, 10).map((h: Record<string, unknown>, index: number) => {
    const text = String(h.text ?? "").trim();
    if (!text) throw new Error(`第 ${index + 1} 个 Hook 文案为空`);

    // 兼容旧格式 score → overallScore
    let overallScore = Number(h.overallScore ?? h.score ?? 0);
    if (isNaN(overallScore)) overallScore = 7;
    overallScore = Math.max(1, Math.min(10, Math.round(overallScore)));

    // 兼容缺失 scores
    const scores = h.scores && typeof h.scores === "object"
      ? normalizeScores(h.scores as Record<string, unknown>)
      : { impact: overallScore, platformFit: overallScore, actionability: overallScore, shareability: overallScore };

    return {
      id: generateId(),
      text,
      style: String(h.style ?? "未知风格").trim(),
      reasoning: String(h.reasoning ?? "").trim(),
      scores,
      overallScore,
      badcaseTags: detectBadcases({ text, reasoning: String(h.reasoning ?? ""), style: String(h.style ?? ""), wordLimit }),
    };
  });

  // analysis 可选
  const analysis = obj.analysis && typeof obj.analysis === "object"
    ? {
        bestStyle: String((obj.analysis as Record<string, unknown>).bestStyle ?? ""),
        commonPattern: String((obj.analysis as Record<string, unknown>).commonPattern ?? ""),
        improvementTip: String((obj.analysis as Record<string, unknown>).improvementTip ?? ""),
      }
    : undefined;

  return { hooks, analysis };
}
```

#### F. POST 函数中组装 response 的变更

在 `POST` 函数中，将原来的：
```ts
const hooks = validateAndCleanHooks(parsed);
const response: GenerateResponse = { hooks, generatedAt, topic, platform, contentType };
```
替换为：
```ts
const wordLimit = body.wordLimit ?? 80;
const { hooks, analysis } = validateAndCleanHooks(parsed, wordLimit);
const response: GenerateResponse = {
  hooks,
  generatedAt: new Date().toISOString(),
  topic: topic.trim(),
  platform,
  contentType,
  targetAudience: body.targetAudience || undefined,
  emotionTone: body.emotionTone || undefined,
  wordLimit,
  analysis,
};
```

同时 `max_tokens` 从 4096 改为 8192。`userPrompt` 传入完整 request 对象。

---

## Phase 2：UI 层改造

### 2.1 `components/InputPanel.tsx`

**新增 import：**
```ts
import type { EmotionTone } from "@/lib/types";
import { EMOTION_TONE_CONFIG } from "@/lib/constants";
```

**新增 Props（追加到现有 interface 中）：**
```ts
targetAudience: string;
setTargetAudience: (v: string) => void;
emotionTone: EmotionTone | "";
setEmotionTone: (e: EmotionTone | "") => void;
wordLimit: number;
setWordLimit: (n: number) => void;
```

**在"内容类型"按钮组和"生成按钮"之间，插入高级选项区域：**

```tsx
{/* 高级选项 — 默认折叠 */}
<div className="border-t border-gray-100 pt-4">
  <button
    type="button"
    onClick={() => setAdvancedOpen(!advancedOpen)}
    className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
  >
    <span>{advancedOpen ? "▼" : "▶"}</span>
    <span>⚙️ 高级选项</span>
  </button>

  {advancedOpen && (
    <div className="mt-4 space-y-4">
      {/* 目标用户 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">目标用户</label>
        <input
          type="text"
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          placeholder="例如：25-35岁职场女性、大学生、新手宝妈…"
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          disabled={loading}
        />
      </div>

      {/* 情绪风格 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">情绪风格</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEmotionTone("")}
            disabled={loading}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              emotionTone === "" ? "bg-violet-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
            }`}
          >
            🤖 自动
          </button>
          {(Object.keys(EMOTION_TONE_CONFIG) as EmotionTone[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEmotionTone(t)}
              disabled={loading}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                emotionTone === t ? "bg-violet-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {EMOTION_TONE_CONFIG[t].icon} {EMOTION_TONE_CONFIG[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* 字数限制 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          字数限制：<span className="text-violet-600 font-semibold">{wordLimit}</span> 字
        </label>
        <input
          type="range"
          min={30}
          max={150}
          step={10}
          value={wordLimit}
          onChange={(e) => setWordLimit(Number(e.target.value))}
          disabled={loading}
          className="w-full accent-violet-600"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>30</span><span>150</span>
        </div>
      </div>
    </div>
  )}
</div>
```

**需要新增组件内 state：** `const [advancedOpen, setAdvancedOpen] = useState(false);`

### 2.2 `components/HookCard.tsx`

**改动范围：** 第 84–111 行的评分区域整块替换。

**替换为：**

```tsx
{/* Scores */}
{hook.scores ? (
  <div className="space-y-1.5 mb-2">
    {[
      { key: "impact",       label: "冲击力",   value: hook.scores.impact },
      { key: "platformFit",  label: "平台匹配", value: hook.scores.platformFit },
      { key: "actionability",label: "可操作性", value: hook.scores.actionability },
      { key: "shareability", label: "传播力",   value: hook.scores.shareability },
    ].map((dim) => (
      <div key={dim.key} className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-14 shrink-0">{dim.label}</span>
        <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              dim.value >= 8 ? "bg-emerald-500" : dim.value >= 6 ? "bg-amber-500" : "bg-rose-500"
            }`}
            style={{ width: `${(dim.value / 10) * 100}%` }}
          />
        </div>
        <span className={`text-xs font-semibold w-8 text-right ${
          dim.value >= 8 ? "text-emerald-600" : dim.value >= 6 ? "text-amber-600" : "text-rose-600"
        }`}>
          {dim.value}
        </span>
      </div>
    ))}
  </div>
) : (
  // 旧数据兼容：单一评分条
  <div className="flex items-center gap-2 mb-2">
    <span className="text-xs text-gray-400">点击欲望</span>
    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${
          overallScore >= 8 ? "bg-emerald-500" : overallScore >= 6 ? "bg-amber-500" : "bg-rose-500"
        }`}
        style={{ width: `${(overallScore / 10) * 100}%` }}
      />
    </div>
    <span className="text-xs font-semibold">{overallScore}/10</span>
  </div>
)}

{/* Badcase tags */}
{finalBadcaseTags.length > 0 && (
  <div className="flex flex-wrap gap-1 mb-2">
    {finalBadcaseTags.map((tag) => (
      <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
        {tag}
      </span>
    ))}
  </div>
)}
```

**在组件顶部新增兼容计算：**
```ts
const overallScore = hook.overallScore ?? hook.score ?? 7;
const finalBadcaseTags = hook.badcaseTags ?? [];
```

**⚠️ 现有代码中 6 处 `hook.score`（第 91/93/97/102/104/109 行）全部替换为 `overallScore`。**

### 2.3 `components/HookGrid.tsx`

**新增 Props：**
```ts
analysis?: GenerateResponse["analysis"];
```

**在 `<section>` 开头（`<h2>` 之前）新增 analysis 卡片：**

```tsx
{analysis && (analysis.bestStyle || analysis.commonPattern) && (
  <div className="mb-6 rounded-xl bg-violet-50 border border-violet-100 p-4">
    <p className="text-xs font-semibold text-violet-700 mb-2">📊 生成分析</p>
    <div className="space-y-1 text-sm text-violet-800">
      {analysis.bestStyle && <p>🏆 最佳风格：{analysis.bestStyle}</p>}
      {analysis.commonPattern && <p>🔍 共性规律：{analysis.commonPattern}</p>}
      {analysis.improvementTip && <p>💡 优化建议：{analysis.improvementTip}</p>}
    </div>
  </div>
)}
```

**`handleCopyAll` 中不改 score 引用**（当前实现只用 `h.text` 和 `h.style`，不涉及 score）。

### 2.4 `components/HistoryDrawer.tsx`

**仅改动第 172 行：**
```diff
- 评分 {hook.score}/10
+ 评分 {hook.overallScore ?? (hook as any).score ?? "?"}/10
```

### 2.5 `components/FavoritesDrawer.tsx`

**仅改动第 133 行：**
```diff
- {hook.score}/10
+ {hook.overallScore ?? (hook as any).score ?? "?"}/10
```

### 2.6 `app/page.tsx`

**新增 import：**
```ts
import type { EmotionTone } from "@/lib/types";
```

**新增 state（紧接现有 useState 之后）：**
```ts
const [targetAudience, setTargetAudience] = useState("");
const [emotionTone, setEmotionTone] = useState<EmotionTone | "">("");
const [wordLimit, setWordLimit] = useState(80);
const [analysis, setAnalysis] = useState<GenerateResponse["analysis"]>(null);
```

**handleGenerate 中 API 请求 body 扩展为：**
```ts
body: JSON.stringify({
  topic: topic.trim(),
  platform,
  contentType,
  targetAudience: targetAudience || undefined,
  emotionTone: emotionTone || undefined,
  wordLimit,
}),
```

**请求成功后新增：**
```ts
setAnalysis(response.analysis ?? null);
```

**InputPanel 传参新增 6 个 props：**
```tsx
<InputPanel
  // ... existing props
  targetAudience={targetAudience}
  setTargetAudience={setTargetAudience}
  emotionTone={emotionTone}
  setEmotionTone={setEmotionTone}
  wordLimit={wordLimit}
  setWordLimit={setWordLimit}
/>
```

**HookGrid 传参新增：**
```tsx
<HookGrid
  hooks={hooks}
  favoritedIds={favorites}
  onToggleFavorite={handleToggleFavorite}
  analysis={analysis}
/>
```

**idle 状态下重置 analysis：** 无动作时 `analysis` 保持 null，无需额外处理。

---

## Phase 3：埋点系统

### 3.1 `hooks/useAnalytics.ts` — 新建文件

```ts
"use client";

import { useCallback, useMemo } from "react";
import type { Platform } from "@/lib/types";

type EventType =
  | "generation_start"
  | "generation_complete"
  | "generation_error"
  | "hook_copied"
  | "hook_favorited"
  | "hook_unfavorited"
  | "history_reused";

interface AnalyticsEvent {
  type: EventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

interface AnalyticsStats {
  totalGenerations: number;
  totalHooksGenerated: number;
  favoritedCount: number;
  copiedCount: number;
  avgScore: number;
  completionRate: number;
  platformDistribution: Record<string, number>;
  favoriteRate: number;
  copyRate: number;
}

const STORAGE_KEY = "ai-hook-lab-analytics";
const MAX_EVENTS = 1000;

function loadEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEvents(events: AnalyticsEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch { /* ignore */ }
}

export function useAnalytics() {
  const events = useMemo(() => loadEvents(), []);

  const track = useCallback((type: EventType, payload?: Record<string, unknown>) => {
    const current = loadEvents();
    current.push({ type, timestamp: new Date().toISOString(), payload });
    saveEvents(current);
  }, []);

  const stats = useMemo((): AnalyticsStats => {
    const all = loadEvents();
    const starts = all.filter((e) => e.type === "generation_start").length;
    const completes = all.filter((e) => e.type === "generation_complete");
    const errors = all.filter((e) => e.type === "generation_error").length;
    const copies = all.filter((e) => e.type === "hook_copied").length;
    const favs = all.filter((e) => e.type === "hook_favorited").length;
    const unfavs = all.filter((e) => e.type === "hook_unfavorited").length;

    const totalHooks = completes.reduce((sum, e) => sum + (Number(e.payload?.hookCount) || 0), 0);
    const scoreSum = completes.reduce((sum, e) => sum + (Number(e.payload?.avgScore) || 0), 0);
    const avgScore = completes.length > 0 ? Math.round((scoreSum / completes.length) * 10) / 10 : 0;

    const platformDist: Record<string, number> = {};
    completes.forEach((e) => {
      const p = String(e.payload?.platform ?? "unknown");
      platformDist[p] = (platformDist[p] || 0) + 1;
    });

    return {
      totalGenerations: starts,
      totalHooksGenerated: totalHooks,
      favoritedCount: favs - unfavs,
      copiedCount: copies,
      avgScore,
      completionRate: starts > 0 ? Math.round((completes.length / starts) * 100) : 0,
      platformDistribution: platformDist,
      favoriteRate: totalHooks > 0 ? Math.round(((favs - unfavs) / totalHooks) * 100) : 0,
      copyRate: totalHooks > 0 ? Math.round((copies / totalHooks) * 100) : 0,
    };
  }, []);

  const resetStats = useCallback(() => {
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { track, stats, resetStats };
}
```

**接入点（在 page.tsx 中调用 useAnalytics，通过 props 下传 track 函数）：**

| 事件 | 触发位置 | payload |
|------|---------|---------|
| `generation_start` | page.tsx `handleGenerate` 开头 | `{ topic, platform, contentType }` |
| `generation_complete` | page.tsx `handleGenerate` 成功分支 | `{ platform, contentType, hookCount, avgScore, durationMs }` |
| `generation_error` | page.tsx `handleGenerate` 错误分支 | `{ error: error.title }` |
| `hook_copied` | HookCard `handleCopy` | `{ hookId, style }` |
| `hook_favorited` / `hook_unfavorited` | page.tsx `handleToggleFavorite` | `{ hookId }` |

---

## Phase 4：评测框架 + README 沉淀

### 4.1 目录结构

```
eval/
  README.md
  topics.json
  run-eval.ts
  score-template.csv
  results/
    .gitkeep
```

### 4.2 `eval/topics.json`

20 个主题，覆盖 8 个类别：

```json
[
  { "id": 1,  "topic": "AI 写周报",        "category": "AI工具",   "difficulty": "low",  "targetAudience": "职场新人" },
  { "id": 2,  "topic": "早起打卡",          "category": "习惯养成", "difficulty": "low",  "targetAudience": "大学生" },
  { "id": 3,  "topic": "二手车避坑",        "category": "消费决策", "difficulty": "mid",  "targetAudience": "首次购车者" },
  { "id": 4,  "topic": "35岁转行",          "category": "职场成长", "difficulty": "high", "targetAudience": "30-40岁职场人" },
  { "id": 5,  "topic": "平价护肤好物",      "category": "生活方式", "difficulty": "low",  "targetAudience": "学生党" },
  { "id": 6,  "topic": "Python 入门",       "category": "知识科普", "difficulty": "mid",  "targetAudience": "编程零基础" },
  { "id": 7,  "topic": "租房合同陷阱",      "category": "消费决策", "difficulty": "mid",  "targetAudience": "应届毕业生" },
  { "id": 8,  "topic": "副业搞钱",          "category": "职场成长", "difficulty": "high", "targetAudience": "25-35岁上班族" },
  { "id": 9,  "topic": "孕期饮食指南",      "category": "生活方式", "difficulty": "high", "targetAudience": "准妈妈" },
  { "id": 10, "topic": "面试谈薪技巧",      "category": "职场成长", "difficulty": "mid",  "targetAudience": "求职者" },
  { "id": 11, "topic": "露营装备清单",      "category": "生活方式", "difficulty": "low",  "targetAudience": "户外新手" },
  { "id": 12, "topic": "猫咪行为解读",      "category": "生活方式", "difficulty": "low",  "targetAudience": "养猫新手" },
  { "id": 13, "topic": "ESG 投资入门",      "category": "知识科普", "difficulty": "high", "targetAudience": "理财小白" },
  { "id": 14, "topic": "咖啡新手入门",      "category": "生活方式", "difficulty": "mid",  "targetAudience": "咖啡爱好者" },
  { "id": 15, "topic": "考研政治复习",      "category": "学习效率", "difficulty": "mid",  "targetAudience": "考研党" },
  { "id": 16, "topic": "新房装修流程",      "category": "消费决策", "difficulty": "mid",  "targetAudience": "首次购房者" },
  { "id": 17, "topic": "ChatGPT 插件推荐",  "category": "AI工具",   "difficulty": "low",  "targetAudience": "效率工具爱好者" },
  { "id": 18, "topic": "冥想入门指南",      "category": "情绪共鸣", "difficulty": "mid",  "targetAudience": "压力大人群" },
  { "id": 19, "topic": "跨境电商选品",      "category": "知识科普", "difficulty": "high", "targetAudience": "电商创业者" },
  { "id": 20, "topic": "字体设计教程",      "category": "知识科普", "difficulty": "mid",  "targetAudience": "设计初学者" }
]
```

### 4.3 `eval/run-eval.ts`

```ts
/**
 * AI Hook Lab 评测脚本
 * 用法：先启动 npm run dev，然后 npx tsx eval/run-eval.ts
 */

const BASE_URL = "http://localhost:3000";
const PLATFORMS = ["xiaohongshu", "douyin", "bilibili"] as const;
const DELAY_MS = 2000;

interface EvalTopic {
  id: number;
  topic: string;
  category: string;
  difficulty: string;
  targetAudience: string;
}

interface HookResult {
  text: string;
  style: string;
  overallScore: number;
  scores: { impact: number; platformFit: number; actionability: number; shareability: number };
  reasoning: string;
  badcaseTags?: string[];
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function generate(topic: EvalTopic, platform: string) {
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topic.topic,
      platform,
      contentType: "video",
      targetAudience: topic.targetAudience,
      wordLimit: 80,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const topics: EvalTopic[] = require("./topics.json");
  const fs = require("fs");
  const path = require("path");
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const csvRows = ["topic,category,difficulty,platform,hook_index,style,text,overallScore,impact,platformFit,actionability,shareability,reasoning,badcaseTags"];
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (const topic of topics) {
    for (const platform of PLATFORMS) {
      const label = `[${topic.id}/20] ${topic.topic} @ ${platform}`;
      process.stdout.write(`${label} ... `);
      try {
        const data = await generate(topic, platform);
        const filePath = path.join(resultsDir, `${topic.id}-${platform}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        data.hooks?.forEach((h: HookResult, i: number) => {
          csvRows.push([
            topic.topic, topic.category, topic.difficulty, platform, i + 1,
            `"${(h.style ?? "").replace(/"/g, '""')}"`,
            `"${(h.text ?? "").replace(/"/g, '""')}"`,
            h.overallScore, h.scores?.impact, h.scores?.platformFit,
            h.scores?.actionability, h.scores?.shareability,
            `"${(h.reasoning ?? "").replace(/"/g, '""')}"`,
            (h.badcaseTags ?? []).join(";"),
          ].join(","));
        });

        console.log(`OK (${data.hooks?.length ?? 0} hooks)`);
        successCount++;
      } catch (err: any) {
        console.log(`FAIL (${err.message})`);
        failCount++;
      }
      await sleep(DELAY_MS);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  fs.writeFileSync(path.join(resultsDir, "for-scoring.csv"), "﻿" + csvRows.join("\n"));

  console.log(`\n=== 评测完成 ===`);
  console.log(`成功: ${successCount}/60, 失败: ${failCount}/60, 耗时: ${elapsed}s`);
  console.log(`结果已保存到 eval/results/`);
  console.log(`评分用 CSV: eval/results/for-scoring.csv`);
}

main().catch(console.error);
```

### 4.4 `eval/score-template.csv`

```csv
topic,platform,hook_index,style,text,吸引力(1-5),平台语气(1-5),可操作性(1-5),逻辑合理性(1-5),直接可用性(1-5),badcase标注,备注
```

### 4.5 `eval/README.md`

```markdown
# AI Hook Lab 评测说明

## 评测目的
验证结构化 Prompt + 四维评分体系是否比原始 Prompt 提升了 Hook 的可用性和平台匹配度。

## 评测范围
- 20 个主题 × 3 个平台（小红书/抖音/B站）= 60 组生成
- 每组 10 条 Hook = 共 600 条 Hook

## 执行方式
1. `npm run dev` 启动开发服务器
2. `npx tsx eval/run-eval.ts` 批量生成
3. 打开 `eval/results/for-scoring.csv` 进行人工评分

## 人工评分维度（1-5 分）
| 维度 | 1 分 | 3 分 | 5 分 |
|------|------|------|------|
| 吸引力 | 不会点击 | 可能停留 | 一定点击 |
| 平台语气 | 完全不匹配 | 部分匹配 | 原生感强 |
| 可操作性 | 不知道要讲什么 | 大概知道 | 清晰可执行 |
| 逻辑合理性 | 牵强附会 | 基本合理 | 严丝合缝 |
| 直接可用性 | 需要大改 | 改改能用 | 直接能发 |

## 统计指标
- **可用率** = 人工评分 ≥ 4（可直接使用或微调后使用）的 Hook 占比
- **平台不匹配率** = "平台语气"评分 ≤ 2 的占比
- **平均 AI 评分 vs 平均人工评分** 相关性
- **Bad Case 分布** = 按 too_generic / platform_mismatch / weak_reasoning / too_long / clickbait_risk 归类

## Bad Case 分类
| 类型 | 定义 | 示例 |
|------|------|------|
| too_generic | 标题过泛，放到任何主题都能用 | "这个方法太绝了！一定要看！" |
| platform_mismatch | 平台语气不匹配 | 小红书出现硬核科普语气 |
| weak_reasoning | 评分理由空泛 | "运用了悬念手法吸引用户" |
| too_long | 超出字数限制 | 120 字 Hook |
| clickbait_risk | 标题党风险 | "全网都在疯传…" |

## 迭代闭环
1. 首轮评测 → 统计可用率 + Top-3 Bad Case
2. 针对性修改 Prompt（加约束/示例）
3. 次轮评测 → 对比可用率变化
4. 重复直到可用率 > 80%
```

### 4.6 `eval/results/.gitkeep` — 空文件

### 4.7 `README.md` — 末尾新增「产品复盘」章节

```markdown
## 产品复盘

### 背景
内容创作者在多平台分发时面临三个核心痛点：
1. **开头吸引力不足** — 前 3 秒抓不住用户，完播率低
2. **平台语气难迁移** — 同一主题在小红书/抖音/B站需要不同表达方式
3. **灵感难复用** — 好的 Hook 没有沉淀机制，每次从头想

### 解决方案
设计了「主题输入 → 平台选择 → 结构化 Prompt 生成 → 多版本 Hook 输出 → 四维评分推荐 → 收藏复用」的完整闭环。

### Prompt 设计
定义 6 个输入变量：platform / topic / contentType / targetAudience / emotionTone / wordLimit。
每种平台 10 个风格模板，共 50 个风格，一次生成 10 条不同风格的 Hook。

### 评分体系
四维评分：冲击力(35%) / 平台匹配度(30%) / 可操作性(20%) / 传播力(15%)，加权得出综合分。
评分理由要求具体到词句层面，避免模板化套话。

### 评测方法
选取 20 个不同主题，分别生成小红书/抖音/B站风格 Hook，对 600 条输出进行人工评分，
统计可用率、平均评分和 Bad Case 分布。

### Bad Case 迭代
识别出 too_generic / platform_mismatch / weak_reasoning / too_long / clickbait_risk 五类问题，
通过 Prompt 约束、示例补充和输出格式限制进行迭代优化。

### 项目成果（简历可用）
- 独立完成 AI Hook Lab AIGC 工具 Demo，覆盖 5 个平台、5 种内容类型、10 种风格模板
- 设计结构化 Prompt 模板，将 6 个输入变量映射为多维评分输出
- 设计四维评分体系（冲击力/平台匹配度/可操作性/传播力），提升生成结果可解释性和可比较性
- 搭建 20 主题 × 3 平台的小型评测集（600 条 Hook），通过人工评分驱动 Prompt 迭代
- 完成度：生成完成率 __%，收藏率 __%，可用率 __%
```

---

## 验收标准

### 基础功能
- [ ] `npm run dev` 启动无报错
- [ ] 不展开高级选项时，原流程正常（向后兼容）
- [ ] 展开高级选项 → 填入字段 → 生成结果体现约束
- [ ] HookCard 展示四维评分条（新数据）或单评分条（旧数据）
- [ ] analysis 摘要卡片正常展示（有数据时）
- [ ] badcase 标签正常展示（有标签时）
- [ ] 单条复制 / 一键复制 / 收藏 / 历史记录 全部正常
- [ ] 旧 localStorage 数据不报错

### API 稳定性
- [ ] 模型返回旧格式 `score` 时自动兼容
- [ ] 模型缺少 `scores` 时自动兜底
- [ ] 模型缺少 `analysis` 时前端不报错
- [ ] 所有分数被 clamp 到 1–10
- [ ] 30s 超时 + 401/429 错误处理正常

### 评测体系
- [ ] `npx tsx eval/run-eval.ts` 能跑完 60 次调用
- [ ] `eval/results/for-scoring.csv` 正常输出
- [ ] `eval/score-template.csv` 可用于人工评分
- [ ] `eval/README.md` 说明评测方法

### 工程
- [ ] `npm run build` 零 TS 错误
- [ ] 无新增依赖
- [ ] 未删除 localStorage 旧数据
- [ ] `Header.tsx` `SkeletonCards.tsx` `layout.tsx` `globals.css` 未改动

---

## 注意事项清单

1. **`.score` 引用共 9 处**（HookCard 6处 + HistoryDrawer 1处 + FavoritesDrawer 1处 + API route 1处），全部需要改为兼容写法。
2. **max_tokens 从 4096 改为 8192**，否则 analysis + scores 会截断 JSON。
3. **InputPanel 需要新增 `useState(false)` 管理高级选项折叠**。记得 import `useState`（当前文件未 import，需要加上）。
4. **HookCard 的 `styleIndex` 属性仅用于颜色**，不改逻辑。
5. **FavoritesDrawer 的 `colorClass` 计算逻辑不动**（已知问题，不在本次范围）。
6. **`(hook as any).score` 是旧数据兼容的最后防线**，不要移除。
7. **`import type { EmotionTone }` 需要添加到 `constants.ts`、`page.tsx`、`InputPanel.tsx`**。
8. **eval/run-eval.ts 使用 `require` 和 `__dirname`**，用 `npx tsx` 运行不需要额外配置。
9. **CSV 文件开头 BOM `﻿`** 确保 Excel 正确识别中文。

---

## 禁止事项

- ❌ 不改 `globals.css` / `tailwind` 配置
- ❌ 不改 `Header.tsx` / `SkeletonCards.tsx` / `layout.tsx`
- ❌ 不改 `next.config.ts` / `tsconfig.json` / `package.json`
- ❌ 不引入新 npm 依赖
- ❌ 不引入数据库 / 登录系统 / 后台管理
- ❌ 不删除 localStorage 旧数据
- ❌ 不把评测系统做成 Web 页面（脚本足够）

---

## v4 实施补充：创作者工作台闭环

### 产品目标

本轮优化不是单纯扩展生成字段，而是把 Demo 从“一次性 Hook 生成器”升级为创作者工作台，围绕以下痛点建立闭环：

1. **开头 3 秒吸引力不足**：通过结构化 Prompt 和四维评分提升 Hook 可比较性。
2. **平台语气难迁移**：将 platform、contentType、targetAudience、emotionTone、wordLimit 作为显式变量。
3. **灵感难复用**：通过历史、收藏、采用标记、平台适配满意度把结果沉淀为创作资产。

### 代码实现修订

- `HookResult.score` 只作为旧数据兼容字段保留，新生成结果优先使用 `overallScore` 和 `scores`。
- `adopted` 与 `platformSatisfaction` 存在于每条 Hook 上，用于计算采用率和平台适配满意度。
- `hooks/useAnalytics.ts` 使用独立 localStorage key：`ai-hook-lab-analytics`，不删除旧 history/favorites 数据。
- API 中 bad case 标签覆盖：`too_generic`、`platform_mismatch`、`weak_reasoning`、`too_long`、`too_short`、`clickbait_risk`。
- `max_tokens` 调整为 8192，降低四维评分和 analysis 被截断的概率。

### 评测执行修订

为遵守“不新增依赖”，评测脚本使用原生 Node ESM：

```bash
node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0
node eval/run-eval.mjs
```

不使用 `npx tsx`，不修改 `package.json`。

### 指标定义

- **生成完成率** = `generation_complete / generation_start`
- **收藏率** = `hook_favorited / totalHooksGenerated`
- **采用率** = `hook_adopted / totalHooksGenerated`
- **平台适配满意度** = `platform_satisfaction.rating` 均值
- **Bad case 分布** = 评测 CSV 中 `badcaseTags` 的类别统计

### GitHub Skill 参考

外部 skills 只作为方法参考，不安装到项目：

- `eval-audit` / `write-judge-prompt`：拆解主观质量评测标准。
- `skill-optimizer`：检查指令是否可触发、可执行、不过度冗长。
- `advanced-evaluation`：设计多轮评测与 bad case 复盘。

### 提交约束

- 实施完成后只创建本地 commit：`Enhance AI Hook Lab creator workflow`
- 不 push。
- 不 stage `.env.local`，API Key 只保留在本地环境文件。

---

## v5 实施补充：后端数据看板

### 目标

新增真正服务端文件存储的数据看板，用于本地 Demo 演示创作者工作台的运营指标。前台继续使用 3000，后台看板使用 3001 端口和 `/dashboard` 路径。

### 数据存储

- 事件写入 `data/dashboard-events.json`。
- `data/*.json` 必须被 `.gitignore` 忽略。
- 只提交 `data` 目录以外的代码与脚本，不提交真实运行数据。

### API

- `POST /api/dashboard/events`：写入 analytics 事件。
- `GET /api/dashboard/summary`：返回聚合后的 totals、rates、averages、platformDistribution、badcaseDistribution、recentEvents。
- Route Handler 必须使用 Node.js runtime，以支持本地文件系统读写。

### 页面与启动

- `/dashboard` 展示后端聚合数据，不读取浏览器 localStorage。
- `start-ai-hook-dashboard.bat` 使用 `npm run dev -- -p 3001` 启动后台端口，并打开 `http://localhost:3001/dashboard`。
- 保留 `start-ai-hook-lab.bat` 不动。

### 提交约束

- 实施完成后只创建本地 commit：`Add backend analytics dashboard`
- 不 push。
