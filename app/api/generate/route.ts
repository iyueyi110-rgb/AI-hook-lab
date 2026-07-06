import { NextRequest, NextResponse } from "next/server";
import type {
  EmotionTone,
  GenerateRequest,
  GenerateResponse,
  HookResult,
  HookScores,
} from "@/lib/types";
import {
  CONTENT_TYPE_CONFIG,
  EMOTION_TONE_CONFIG,
  PLATFORM_CONFIG,
  PLATFORM_STYLES,
} from "@/lib/constants";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const DEFAULT_WORD_LIMIT = 80;

function buildSystemPrompt(): string {
  return `你是一位社交媒体文案策略师，专门帮助短视频/图文创作者解决开头 3 秒吸引力不足、平台语气难迁移、灵感难复用的问题。

你的任务：根据输入变量，为指定平台生成 10 个不同风格的 Hook 开头，并给出可比较、可解释的评分。

好 Hook 的四条标准：
1. 前 3 秒钩子：开头 15 字内制造好奇心缺口、认知冲突或情绪共振。
2. 平台原生感：读起来像该平台创作者的真实表达，不是翻译腔或通用广告文案。
3. 可操作性：读者能清晰预期后续内容会提供什么价值。
4. 传播基因：包含适合截图、引用、复用的表达。

四维评分标准（每维 1-10 分）：
- impact：开头是否有足够冲击力、信息差或情绪张力。
- platformFit：语气、节奏、词汇是否贴合平台。
- actionability：用户是否能判断后续内容价值。
- shareability：是否有可被收藏、转发、截图的表达。

输出要求：
- 只返回纯 JSON，不要 Markdown，不要解释性前后缀。
- reasoning 必须引用具体词句，例如“开头‘做了3年’用数字建立信任，‘才明白’制造反转预期”。
- 禁止使用“运用了悬念手法吸引用户”“抓住用户痛点”这类模板化套话。
- 不要编造违法、医疗诊断、金融收益承诺或侵犯隐私的内容。`;
}

function buildUserPrompt(
  req: GenerateRequest,
  platformLabel: string,
  platformDesc: string,
  contentTypeLabel: string,
  styles: string[]
): string {
  const { topic, targetAudience, emotionTone, wordLimit } = req;
  const toneInstruction = emotionTone
    ? `\n**情绪风格：** ${EMOTION_TONE_CONFIG[emotionTone as EmotionTone]?.label ?? emotionTone} - ${
        EMOTION_TONE_CONFIG[emotionTone as EmotionTone]?.description ?? ""
      }`
    : "";

  return `## 输入变量

**主题：** ${topic}
**平台：** ${platformLabel}（${platformDesc}）
**内容类型：** ${contentTypeLabel}
**目标用户：** ${targetAudience?.trim() || "该平台泛用户群体"}${toneInstruction}
**字数限制：** 每条 Hook 不超过 ${wordLimit ?? DEFAULT_WORD_LIMIT} 字

## 平台风格池
每种风格生成 1 个 Hook，共 10 个：
${styles.map((style, index) => `${index + 1}. ${style}`).join("\n")}

## 输出 JSON 格式
{
  "hooks": [
    {
      "text": "Hook 文案",
      "style": "风格名称（必须从风格池中取）",
      "reasoning": "具体到词句的推荐理由，30-60字",
      "scores": {
        "impact": 8,
        "platformFit": 7,
        "actionability": 7,
        "shareability": 6
      },
      "overallScore": 7
    }
  ],
  "analysis": {
    "bestStyle": "这批中最值得优先采用的风格",
    "commonPattern": "这批 Hook 的共性规律，一句话",
    "improvementTip": "如果效果不理想，下一轮应该调整的输入变量"
  }
}

## 硬约束
- hooks 必须恰好 10 个，每个风格只用一次。
- text 必须控制在字数限制内。
- overallScore 是四维评分的综合分，整数 1-10。
- 平台语气要明显区分，不能把同一句话换平台名复用。
- reasoning 必须引用 Hook 中的具体词句，禁止空泛套话。
- 只返回 JSON。`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampScore(value: unknown, fallback = 7): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function normalizeScores(raw: Record<string, unknown>): HookScores {
  return {
    impact: clampScore(raw.impact),
    platformFit: clampScore(raw.platformFit),
    actionability: clampScore(raw.actionability),
    shareability: clampScore(raw.shareability),
  };
}

function calculateOverallScore(scores: HookScores): number {
  return clampScore(
    scores.impact * 0.35 +
      scores.platformFit * 0.3 +
      scores.actionability * 0.2 +
      scores.shareability * 0.15
  );
}

function countChineseChars(value: string): number {
  return value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
}

function detectBadcases(hook: {
  text: string;
  reasoning: string;
  scores: HookScores;
  wordLimit: number;
}): string[] {
  const tags: string[] = [];

  if (hook.text.length > hook.wordLimit * 1.2) tags.push("too_long");
  if (hook.text.length < 8) tags.push("too_short");

  if (/震惊|不看后悔|全网都在|炸裂|颠覆认知|彻底改变|速看|必看/.test(hook.text)) {
    tags.push("clickbait_risk");
  }

  const genericWords =
    /干货满满|值得收藏|快速提升|太绝了|绝绝子|yyds|一定要看|超级好用|建议收藏|看完就会/gi;
  const matches = hook.text.match(genericWords);
  if (matches && matches.length >= 2) tags.push("too_generic");

  if (
    countChineseChars(hook.reasoning) < 12 ||
    /运用.*手法|吸引用户|抓住痛点|制造悬念/.test(hook.reasoning)
  ) {
    tags.push("weak_reasoning");
  }

  if (hook.scores.platformFit <= 5) tags.push("platform_mismatch");

  return [...new Set(tags)];
}

function normalizeWordLimit(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return DEFAULT_WORD_LIMIT;
  return Math.max(30, Math.min(150, Math.round(parsed)));
}

function validateAndCleanHooks(
  raw: unknown,
  wordLimit: number
): { hooks: HookResult[]; analysis?: GenerateResponse["analysis"] } {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON response from AI");
  }

  const obj = raw as Record<string, unknown>;
  const rawHooks = obj.hooks;

  if (!Array.isArray(rawHooks) || rawHooks.length === 0) {
    throw new Error("AI 返回的 hooks 为空或格式错误");
  }

  const hooks: HookResult[] = rawHooks.slice(0, 10).map((item, index) => {
    const h = item as Record<string, unknown>;
    const text = String(h.text ?? "").trim();
    if (!text) {
      throw new Error(`第 ${index + 1} 个 Hook 文案为空`);
    }

    const rawOverall = h.overallScore ?? h.score;
    const fallbackOverall = clampScore(rawOverall);
    const scores =
      h.scores && typeof h.scores === "object"
        ? normalizeScores(h.scores as Record<string, unknown>)
        : {
            impact: fallbackOverall,
            platformFit: fallbackOverall,
            actionability: fallbackOverall,
            shareability: fallbackOverall,
          };
    const overallScore =
      rawOverall === undefined ? calculateOverallScore(scores) : clampScore(rawOverall);
    const reasoning = String(h.reasoning ?? "").trim();

    return {
      id: generateId(),
      text,
      style: String(h.style ?? "未知风格").trim(),
      reasoning,
      scores,
      overallScore,
      badcaseTags: detectBadcases({ text, reasoning, scores, wordLimit }),
    };
  });

  const analysis =
    obj.analysis && typeof obj.analysis === "object"
      ? {
          bestStyle: String((obj.analysis as Record<string, unknown>).bestStyle ?? ""),
          commonPattern: String((obj.analysis as Record<string, unknown>).commonPattern ?? ""),
          improvementTip: String((obj.analysis as Record<string, unknown>).improvementTip ?? ""),
        }
      : undefined;

  return { hooks, analysis };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "API Key 未配置",
        message:
          "请在项目根目录的 .env.local 文件中添加 DEEPSEEK_API_KEY=你的Key。\n获取 Key：https://platform.deepseek.com",
      },
      { status: 401 }
    );
  }

  let body: GenerateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式错误", message: "请提供有效的 JSON 请求体" },
      { status: 400 }
    );
  }

  const { topic, platform, contentType } = body;

  if (!topic?.trim()) {
    return NextResponse.json(
      { error: "主题为空", message: "请输入一个主题" },
      { status: 400 }
    );
  }

  const platformInfo = PLATFORM_CONFIG[platform];
  const styles = PLATFORM_STYLES[platform];
  const contentTypeInfo = CONTENT_TYPE_CONFIG[contentType];

  if (!platformInfo || !styles) {
    return NextResponse.json(
      { error: "平台不支持", message: `不支持的平台：${platform}` },
      { status: 400 }
    );
  }

  if (!contentTypeInfo) {
    return NextResponse.json(
      { error: "内容类型不支持", message: `不支持的内容类型：${contentType}` },
      { status: 400 }
    );
  }

  const wordLimit = normalizeWordLimit(body.wordLimit);
  const requestBody: GenerateRequest = {
    topic: topic.trim(),
    platform,
    contentType,
    targetAudience: body.targetAudience?.trim() || undefined,
    emotionTone: body.emotionTone || undefined,
    wordLimit,
  };

  const userPrompt = buildUserPrompt(
    requestBody,
    platformInfo.label,
    platformInfo.description,
    contentTypeInfo.label,
    styles
  );

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.95,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`DeepSeek API error ${res.status}: ${errText}`);

      if (res.status === 401) {
        return NextResponse.json(
          {
            error: "API Key 无效",
            message: "DEEPSEEK_API_KEY 无效，请检查 .env.local 中的 Key 是否正确",
          },
          { status: 502 }
        );
      }

      if (res.status === 429) {
        return NextResponse.json(
          {
            error: "请求太频繁",
            message: "API 调用频率已达上限，请稍后再试",
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        {
          error: "AI 服务异常",
          message: `模型服务返回错误（${res.status}），请稍后重试`,
        },
        { status: 502 }
      );
    }

    const data = await res.json();

    const choice = data?.choices?.[0]?.message?.content;
    if (!choice) {
      return NextResponse.json(
        { error: "AI 返回为空", message: "模型未返回有效内容，请重试" },
        { status: 500 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(choice);
    } catch {
      const jsonMatch = choice.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
          return NextResponse.json(
            {
              error: "JSON 解析失败",
              message: "AI 返回的不是有效 JSON，请重试",
            },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json(
          {
            error: "JSON 解析失败",
            message: "AI 返回的不是有效 JSON，请重试",
          },
          { status: 500 }
        );
      }
    }

    const { hooks, analysis } = validateAndCleanHooks(parsed, wordLimit);

    const response: GenerateResponse = {
      hooks,
      generatedAt: new Date().toISOString(),
      topic: topic.trim(),
      platform,
      contentType,
      targetAudience: requestBody.targetAudience,
      emotionTone: requestBody.emotionTone,
      wordLimit,
      analysis,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        {
          error: "请求超时",
          message: "模型响应超时（30秒），请重试或缩短主题描述",
        },
        { status: 504 }
      );
    }

    console.error("Generate error:", err);
    return NextResponse.json(
      {
        error: "生成失败",
        message: err instanceof Error ? err.message : "未知错误，请重试",
      },
      { status: 500 }
    );
  }
}
