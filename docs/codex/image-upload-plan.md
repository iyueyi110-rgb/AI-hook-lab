# AI Hook Lab 创作台 — 图片上传 + 智能识别主题 执行指令

## 需求摘要

为创作台 `InputPanel` 增加图片上传功能。使用者可直接上传内容截图，系统通过 GPT-4o-mini 视觉模型识别图片主题，自动推荐内容类型/发布平台/情绪风格，然后复用现有 DeepSeek 管线生成 Hook。

## 技术约束

- **DeepSeek Chat (`deepseek-chat`) 不支持视觉输入**，不能直接把图片传给 `/api/generate`
- **两步流水线**：GPT-4o-mini 分析图片 → 提取文本描述 → 喂入现有 generate API（generate API 不改动）
- **不存储图片**：图片仅在请求生命周期内存中处理，不写入磁盘或 localStorage

## 改动清单（6 个文件）

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `lib/types.ts` | 修改 | 新增 `ImageAnalysisResult` 类型 |
| 2 | `.env.local.example` | 修改 | 新增 `OPENAI_API_KEY` |
| 3 | `app/api/analyze-image/route.ts` | **新建** | 图片分析 API |
| 4 | `components/InputPanel.tsx` | 修改 | 新增图片上传区 + 分析状态 |
| 5 | `app/page.tsx` | 修改 | 新增图片状态 + 自动填入逻辑 |
| 6 | `lib/promptTemplates.ts` | 修改 | `buildUserPrompt` 支持 `imageContext` 参数 |

---

### 1. `lib/types.ts` — 新增类型

在 `GenerateRequest` 接口中新增 `imageDescription` 可选字段（紧挨 `promptVariant` 下方）：

```ts
export interface GenerateRequest {
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience?: string;
  emotionTone?: EmotionTone | "";
  wordLimit?: number;
  promptVariant?: "baseline" | "candidate";
  imageDescription?: string; // 新增：图片分析后的文字描述，作为附加上下文
}
```

在文件末尾新增 `ImageAnalysisResult` 导出接口：

```ts
export interface ImageAnalysisResult {
  topic: string;
  imageDescription?: string;
  suggestedPlatform?: Platform;
  suggestedContentType?: ContentType;
  suggestedEmotionTone?: EmotionTone;
}
```

---

### 2. `.env.local.example` — 新增环境变量

在 `EVAL_INGEST_TOKEN=` 下方追加一行：

```
# Optional: required for image analysis (GPT-4o-mini vision). Without it image upload is disabled.
OPENAI_API_KEY=
```

---

### 3. `app/api/analyze-image/route.ts` — 新建

创建 POST API 路由，功能：

1. **读取环境变量** `OPENAI_API_KEY`，未配置返回 501
2. **解析请求体** `{ imageBase64: string }`，校验：
   - `imageBase64` 不为空
   - base64 头部包含 `image/jpeg` / `image/png` / `image/webp`
   - base64 数据大小不超过 5MB（(base64.length * 3) / 4 估算原始大小）
3. **调用 OpenAI API** `https://api.openai.com/v1/chat/completions`：
   - model: `gpt-4o-mini`
   - messages:
     - system: 中文 prompt，要求模型分析图片并返回 JSON。明确列出返回字段：`topic`（图片主题，一句话）、`imageDescription`（图片内容详细文字描述，50-100字）、`suggestedPlatform`（从 xiaohongshu/douyin/bilibili/youtube/x 中选一个最合适的）、`suggestedContentType`（从 video/image-text/product-ad/tutorial/opinion 中选一个最适合的）、`suggestedEmotionTone`（从 urgent/curious/humorous/emotional/authoritative/rebellious 中选一个适合的情绪风格）
     - user: `{ type: "image_url", image_url: { url: "data:image/...;base64,..." } }`
   - temperature: 0.3（低温度保证稳定输出）
   - max_tokens: 500
   - response_format: `{ type: "json_object" }`
4. **解析 & 校验返回值**：
   - 检查 `choices[0].message.content` 非空
   - JSON.parse 后校验 `topic` 字段必填且为非空字符串
   - 校验可选字段的枚举值合法性（如在 Platform/ContentType/EmotionTone 允许的取值范围内）
5. **超时 15s**：使用 `AbortController` + `setTimeout`
6. **返回** `ImageAnalysisResult`
7. **错误处理**：401（API Key 无效）、429（频率限制）、其他（服务异常）

> 参考现有 `app/api/generate/route.ts` 的错误处理风格（错误返回 `{ error, message }` + 对应 HTTP 状态码）。

---

### 4. `components/InputPanel.tsx` — 新增图片上传区

#### 4.1 新 Props 类型

在 `InputPanelProps` 接口中新增：

```ts
imageBase64: string | null;
isAnalyzing: boolean;
imageAnalysisError: string | null;
onImageSelect: (base64: string) => void;
onClearImage: () => void;
```

#### 4.2 UI：图片上传区

在"主题" textarea（`<div>` 包裹 `id="topic"` 的 textarea 那一块）**上方** 插入一个图片上传区：

**初始状态（无图片）**：
- 一个 `label` 包裹的虚线框区域，样式：
  - `border-2 border-dashed border-[var(--color-line)] rounded-[var(--radius-md)] p-4`
  - hover 时 `border-[var(--color-line-strong)]`
  - 里面放 `<Camera>` 图标（从 `@phosphor-icons/react` 引入） + 文字 "上传内容截图，自动识别主题"
  - 内含一个隐藏的 `<input type="file" accept="image/jpeg,image/png,image/webp">`
  - 选择文件后读取为 base64（FileReader），调用 `onImageSelect`
  - loading/disabled 状态下禁用

**已有图片时**：
- 显示缩略图（`<img>` 标签，`max-h-32 rounded-md`）
- 右上角放置删除按钮（X 图标），点击调用 `onClearImage`
- 缩略图下方显示主题预览文字（如果有 `imageAnalysis?.topic`）

**分析中**：
- 缩略图上覆盖半透明遮罩 + `soft-pulse` 动画的"正在识别..."文字
- 不需要额外引入新的动画 keyframe，复用已有的 `soft-pulse`

**分析失败**：
- 缩略图下方显示红色错误文字 `imageAnalysisError`

#### 4.3 UI：推荐角标

在 platform 和 contentType 的 `choice-button` 上，对匹配推荐值的按钮：
- 在按钮文字后追加一个橙色小角标 `<span className="ml-1 text-[10px] text-[var(--color-warning)]">荐</span>`
- 需要判断：如果 `imageAnalysis?.suggestedPlatform === item` 且有 imageAnalysis 数据，显示角标

情绪风格的自动选项按钮同理。

---

### 5. `app/page.tsx` — 新增状态 & 自动填入逻辑

#### 5.1 新增 import

```ts
import type { ImageAnalysisResult } from "@/lib/types";
import { Image, Camera } from "@phosphor-icons/react"; // 如果需要用到的话
```

#### 5.2 新增状态

在现有 `useState` 声明区域追加：

```ts
const [imageBase64, setImageBase64] = React.useState<string | null>(null);
const [imageAnalysis, setImageAnalysis] = React.useState<ImageAnalysisResult | null>(null);
const [isAnalyzing, setIsAnalyzing] = React.useState(false);
const [imageAnalysisError, setImageAnalysisError] = React.useState<string | null>(null);
```

#### 5.3 图片选择回调

```ts
const handleImageSelect = React.useCallback(async (base64: string) => {
  setImageBase64(base64);
  setIsAnalyzing(true);
  setImageAnalysisError(null);
  setImageAnalysis(null);

  try {
    const res = await fetch("/api/analyze-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64 }),
    });

    const data = await res.json();

    if (!res.ok) {
      setImageAnalysisError(data.message ?? "图片分析失败");
      setIsAnalyzing(false);
      return;
    }

    const result = data as ImageAnalysisResult;
    setImageAnalysis(result);

    // 自动填入表单
    setTopic(result.topic);
    if (result.suggestedPlatform) setPlatform(result.suggestedPlatform);
    if (result.suggestedContentType) setContentType(result.suggestedContentType);
    if (result.suggestedEmotionTone) setEmotionTone(result.suggestedEmotionTone);

    setIsAnalyzing(false);
  } catch {
    setImageAnalysisError("网络错误，无法分析图片");
    setIsAnalyzing(false);
  }
}, []); // 依赖 setTopic, setPlatform, setContentType, setEmotionTone 是稳定的 setState，不需要放入 deps
```

#### 5.4 清除图片回调

```ts
const handleClearImage = React.useCallback(() => {
  setImageBase64(null);
  setImageAnalysis(null);
  setIsAnalyzing(false);
  setImageAnalysisError(null);
}, []);
```

#### 5.5 修改 handleGenerate

在 `handleGenerate` 的 fetch body 中新增 `imageDescription`：

```ts
body: JSON.stringify({
  topic: topic.trim(),
  platform,
  contentType,
  targetAudience: targetAudience.trim() || undefined,
  emotionTone: emotionTone || undefined,
  wordLimit,
  imageDescription: imageAnalysis?.imageDescription || undefined, // 新增
}),
```

#### 5.6 修改 InputPanel 调用

在 JSX 中 `<InputPanel>` 传入新增的 5 个 props：

```tsx
<InputPanel
  // ... 现有 props 不变
  imageBase64={imageBase64}
  isAnalyzing={isAnalyzing}
  imageAnalysisError={imageAnalysisError}
  onImageSelect={handleImageSelect}
  onClearImage={handleClearImage}
/>
```

---

### 6. `lib/promptTemplates.ts` — 支持图片上下文

#### 6.1 修改 `buildUserPrompt` 函数签名

在参数列表中新增 `imageDescription?: string`：

```ts
export function buildUserPrompt(
  req: GenerateRequest,
  platformLabel: string,
  platformDesc: string,
  contentTypeLabel: string,
  styles: string[],
  promptVariant = DEFAULT_PROMPT_VARIANT,
  imageDescription?: string, // 新增
): string {
```

#### 6.2 在 prompt 中注入图片上下文

在 `**主题：** ${topic}` 的下一行插入：

```ts
**主题：** ${topic}${imageDescription ? `\n**图片参考：** ${imageDescription}` : ""}
```

#### 6.3 修改 `buildPromptBundle` 调用链

`buildPromptBundle` 调用 `buildUserPrompt` 时传入 `req.imageDescription`：

```ts
return {
  // ...
  userPrompt: buildUserPrompt(
    req,
    platformInfo.label,
    platformInfo.description,
    contentTypeInfo.label,
    styles,
    promptVariant,
    req.imageDescription, // 新增
  ),
  // ...
};
```

---

## 不改动的文件

- `app/api/generate/route.ts` — 现有生成管线完全不变（imageDescription 通过已有 body 字段透传）
- `lib/constants.ts` — 平台/内容类型/情绪风格枚举不变
- `app/globals.css` — 复用已有的 `.soft-pulse`、`.editorial-panel`、`.control-base` 等样式类

---

## 验收标准

1. **无图片流程不受影响**：不传图片时，跟之前完全一样地输入文字 → 生成 Hook
2. **上传图片**：点击虚线框选择图片（或拖拽），显示缩略图，自动发起分析
3. **分析中状态**：缩略图上显示脉冲动画 + "正在识别..."
4. **分析完成**：topic 自动填入、platform/contentType/emotionTone 显示推荐角标并自动选中推荐值
5. **手动修改**：自动填入后，用户仍可手动修改任意字段
6. **生成 Hook**：Hook 内容与图片主题相关（因为 `imageDescription` 作为上下文传给了 DeepSeek）
7. **删除图片**：点击删除按钮清空图片和推荐状态
8. **错误处理**：
   - 上传非图片文件 → 前端 accept 过滤 + 后端校验报错
   - 图片超过 5MB → 后端返回错误提示
   - 未配置 `OPENAI_API_KEY` → 返回 501 "图片分析服务未配置"
   - API 调用失败 → 红色错误文字提示
