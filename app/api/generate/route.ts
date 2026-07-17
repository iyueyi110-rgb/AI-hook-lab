import { NextRequest, NextResponse } from "next/server";
import type {
  GenerateRequest,
  GenerateResponse,
  HookResult,
  HookScores,
} from "@/lib/types";
import {
  buildPromptBundle,
  calculateClickScore,
  DEFAULT_WORD_LIMIT,
  detectBadcases,
  findSensitiveInputHints,
  MAX_IMAGE_DESCRIPTION_LENGTH,
  MAX_TARGET_AUDIENCE_LENGTH,
  MAX_TOPIC_LENGTH,
} from "@/lib/promptTemplates";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

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

function normalizeWordLimit(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return DEFAULT_WORD_LIMIT;
  return Math.max(30, Math.min(150, Math.round(parsed)));
}

function validateAndCleanHooks(
  raw: unknown,
  wordLimit: number,
  templateVersion: string,
  promptVariant: string
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
      clickScore: calculateClickScore(overallScore),
      templateVersion,
      promptVariant,
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
  const trimmedTopic = topic?.trim() ?? "";
  const trimmedTargetAudience = body.targetAudience?.trim() ?? "";
  const trimmedImageDescription = body.imageDescription?.trim() ?? "";

  if (!trimmedTopic) {
    return NextResponse.json(
      { error: "主题为空", message: "请输入一个主题" },
      { status: 400 }
    );
  }

  if (trimmedTopic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json(
      {
        error: "主题过长",
        message: `主题最多 ${MAX_TOPIC_LENGTH} 个字符，请缩短后重试`,
      },
      { status: 400 }
    );
  }

  if (trimmedTargetAudience.length > MAX_TARGET_AUDIENCE_LENGTH) {
    return NextResponse.json(
      {
        error: "目标用户描述过长",
        message: `目标用户最多 ${MAX_TARGET_AUDIENCE_LENGTH} 个字符，请缩短后重试`,
      },
      { status: 400 }
    );
  }

  if (trimmedImageDescription.length > MAX_IMAGE_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      {
        error: "图片描述过长",
        message: `图片描述最多 ${MAX_IMAGE_DESCRIPTION_LENGTH} 个字符，请清除图片或更换截图`,
      },
      { status: 400 }
    );
  }

  const sensitiveHints = findSensitiveInputHints(
    `${trimmedTopic}\n${trimmedTargetAudience}\n${trimmedImageDescription}`
  );
  if (sensitiveHints.length > 0) {
    return NextResponse.json(
      {
        error: "输入包含疑似个人信息",
        message: trimmedImageDescription
          ? `图片或输入中包含疑似${sensitiveHints.join("、")}，请清除图片、替换截图或改写后重试`
          : `请移除或改写以下信息后再生成：${sensitiveHints.join("、")}`,
      },
      { status: 400 }
    );
  }

  const wordLimit = normalizeWordLimit(body.wordLimit);
  const requestBody: GenerateRequest = {
    topic: trimmedTopic,
    platform,
    contentType,
    targetAudience: trimmedTargetAudience || undefined,
    emotionTone: body.emotionTone || undefined,
    wordLimit,
    promptVariant: body.promptVariant === "baseline" ? "baseline" : "candidate",
    imageDescription: trimmedImageDescription || undefined,
  };

  let promptBundle: ReturnType<typeof buildPromptBundle>;
  try {
    promptBundle = buildPromptBundle(requestBody);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error && error.message.includes("平台") ? "平台不支持" : "内容类型不支持",
        message: error instanceof Error ? error.message : "请求参数不支持",
      },
      { status: 400 }
    );
  }

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
        model: promptBundle.model,
        messages: [
          { role: "system", content: promptBundle.systemPrompt },
          { role: "user", content: promptBundle.userPrompt },
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

    const { hooks, analysis } = validateAndCleanHooks(
      parsed,
      wordLimit,
      promptBundle.templateVersion,
      promptBundle.promptVariant
    );

    const response: GenerateResponse = {
      hooks,
      generatedAt: new Date().toISOString(),
      topic: trimmedTopic,
      platform,
      contentType,
      model: promptBundle.model,
      templateVersion: promptBundle.templateVersion,
      promptVariant: promptBundle.promptVariant,
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
