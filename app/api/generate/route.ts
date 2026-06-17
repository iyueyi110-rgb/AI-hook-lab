import { NextRequest, NextResponse } from "next/server";
import type { GenerateRequest, GenerateResponse, HookResult } from "@/lib/types";
import { PLATFORM_CONFIG, PLATFORM_STYLES } from "@/lib/constants";

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

function buildSystemPrompt(): string {
  return `你是一位世界级社交媒体文案专家，精通各大平台的爆款内容创作。

你的任务：根据用户提供的信息，生成 10 个不同风格的爆款 Hook。

核心要求：
- 每个 Hook 必须精彩、引人入胜，让读者忍不住点击
- 严格匹配对应风格的写作特征
- scores 评分要真实客观（基于文本冲击力、好奇心缺口、情绪张力打分）
- reasoning 要具体，不能用套话，要说清楚这个 hook 为什么能引爆

输出格式：纯 JSON，不要 Markdown 包裹，不要额外文字。`;
}

function buildUserPrompt(
  topic: string,
  platform: string,
  platformDesc: string,
  contentType: string,
  styles: string[]
): string {
  const styleInstructions = styles
    .map((style, i) => `${i + 1}. ${style}`)
    .join("\n");

  return `## 任务信息

**主题：** ${topic}
**平台：** ${platform}（${platformDesc}）
**内容类型：** ${contentType}

## 平台风格池（必须每种风格各生成一个 Hook）

${styleInstructions}

## 输出格式

返回严格 JSON：
{
  "hooks": [
    {
      "text": "Hook 文案",
      "style": "风格名称（必须从风格池中选取）",
      "score": 8,
      "reasoning": "这个 hook 运用了XX手法，关键词XX制造了XX钩子，能吸引这个平台的XX人群"
    }
  ]
}

关键约束：
- hooks 数组必须恰好 10 个
- 每个风格只用一次，不要重复
- text 长度控制在 15-80 字之间
- score 是整数 1-10
- reasoning 30-60 字，具体说明引爆原理
- 只返回 JSON，不要任何额外说明文字`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateAndCleanHooks(raw: unknown): HookResult[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON response from AI");
  }

  const obj = raw as Record<string, unknown>;
  const hooks = obj.hooks;

  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new Error("AI 返回的 hooks 为空或格式错误");
  }

  return hooks.slice(0, 10).map((h: Record<string, unknown>, index: number) => {
    const text = String(h.text ?? "").trim();
    if (!text) {
      throw new Error(`第 ${index + 1} 个 Hook 文案为空`);
    }

    let score = Number(h.score ?? 0);
    if (isNaN(score)) score = 7;
    score = Math.max(1, Math.min(10, Math.round(score)));

    return {
      id: generateId(),
      text,
      style: String(h.style ?? "未知风格").trim(),
      score,
      reasoning: String(h.reasoning ?? "").trim(),
    };
  });
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

  if (!platformInfo || !styles) {
    return NextResponse.json(
      { error: "平台不支持", message: `不支持的平台：${platform}` },
      { status: 400 }
    );
  }

  const userPrompt = buildUserPrompt(
    topic.trim(),
    platformInfo.label,
    platformInfo.description,
    contentType,
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
        temperature: 1.0,
        max_tokens: 4096,
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
      // Try to extract JSON from markdown code blocks
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

    const hooks = validateAndCleanHooks(parsed);

    const response: GenerateResponse = {
      hooks,
      generatedAt: new Date().toISOString(),
      topic: topic.trim(),
      platform,
      contentType,
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
