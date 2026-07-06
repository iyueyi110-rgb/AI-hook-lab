# AI Hook Lab

AI Hook Lab 是一个面向内容创作者的爆款 Hook 生成工具。输入主题、平台和内容类型后，应用会调用 DeepSeek 生成 10 个不同风格的开头文案，并支持历史记录与收藏。

## 功能

- 支持小红书、抖音、B 站、YouTube、X 等平台
- 支持视频、图文、产品广告、教程、观点帖等内容类型
- 每次生成 10 条不同风格的 Hook
- 支持目标用户、情绪风格、字数限制等高级输入变量
- 展示点击欲望、冲击力、平台匹配、可操作性、传播力评分
- 支持 bad case 标签、生成分析、采用标记和平台适配满意度
- 本地保存生成历史和收藏
- 支持一键复制单条或全部 Hook

## 本地运行

### 一键启动（Windows）

双击项目根目录下的 `start-ai-hook-lab.bat`。

启动按钮会自动检查依赖、创建 `.env.local`（如果还没有）、打开浏览器，并启动开发服务。

首次使用时，请在弹出的 `.env.local` 中填入 DeepSeek API Key：

```bash
DEEPSEEK_API_KEY=your_api_key_here
```

### 后台数据看板

双击项目根目录下的 `start-ai-hook-dashboard.bat`。

后台脚本会使用 3001 端口启动同一个 Next.js 应用，并自动打开：

```bash
http://localhost:3001/dashboard
```

看板数据来自服务端文件 `data/dashboard-events.json`。该文件由 `/api/dashboard/events` 写入，用于统计生成完成率、收藏率、采用率、复制率、平台适配满意度、平台分布和 bad case 分布。运行数据已被 `.gitignore` 忽略，不会进入提交。

### 手动启动

1. 安装依赖：

```bash
npm install
```

2. 配置环境变量：

复制 `.env.local.example` 为 `.env.local`，并填入 DeepSeek API Key。

```bash
DEEPSEEK_API_KEY=your_api_key_here
```

3. 启动开发服务：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

后台看板手动启动：

```bash
npm run dev -- -p 3001
```

打开 [http://localhost:3001/dashboard](http://localhost:3001/dashboard) 查看数据看板。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
```

## 评测命令

启动开发服务后，可以运行小样本评测：

```bash
node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0
```

完整评测会调用 60 组生成请求：

```bash
node eval/run-eval.mjs
```

## 环境变量

| 名称 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于服务端生成 Hook |

## 技术栈

- Next.js
- React
- TypeScript
- Tailwind CSS

## 产品复盘

### 背景

短视频和图文创作者在多平台分发时，常见痛点有三类：

1. 开头 3 秒吸引力不足，用户没有停留动机。
2. 平台语气难迁移，同一主题在小红书、抖音、B站、YouTube、X 上需要不同表达。
3. 灵感难复用，生成过的好开头没有沉淀成可再次调用的资产。

### 核心路径

AI Hook Lab 定义了“主题输入 - 平台选择 - 多版 Hook 生成 - 评分推荐 - 收藏复用”的主路径。用户输入主题，选择平台和内容类型，可选填写目标用户、情绪风格、字数限制。系统一次生成 10 条不同风格 Hook，并给出评分、推荐理由、bad case 标签和生成分析。

### Prompt 设计

结构化 Prompt 将 `platform`、`topic`、`contentType`、`targetAudience`、`emotionTone`、`wordLimit` 映射到模型输出。输出字段包含 Hook 文案、风格标签、四维评分、综合点击欲望评分、推荐理由和整体分析。推荐理由要求引用具体词句，避免“运用了悬念手法”这类空泛套话。

### 评分体系

评分包含四个维度：

- 冲击力：前 3 秒是否制造信息差、冲突或情绪张力。
- 平台匹配：语气、节奏、词汇是否像该平台原生内容。
- 可操作性：读者是否能预期后续内容价值。
- 传播力：是否具备收藏、截图、引用或转发价值。

综合分用于排序和快速比较，四维评分用于解释为什么某条 Hook 更值得采用。

### 资产沉淀

历史记录保存每次生成结果，收藏夹沉淀高价值 Hook。结果卡片支持复制、收藏、标记已采用和平台适配满意度评分，让工具从“一次性生成器”转为可复盘的创作资产工作台。

### 评估指标

- 生成完成率 = 成功生成次数 / 发起生成次数
- 收藏率 = 收藏 Hook 数 / 生成 Hook 数
- 采用率 = 标记采用 Hook 数 / 生成 Hook 数
- 平台适配满意度 = 用户对 Hook 平台匹配程度的 1-5 分均值
- Bad case 分布 = 标题过泛、平台语气不匹配、评分理由空泛、过长、标题党风险

### Bad Case 迭代

Demo 测试重点观察 `too_generic`、`platform_mismatch`、`weak_reasoning`、`too_long`、`clickbait_risk`。后续通过 Prompt 约束、示例补充和输出格式限制持续迭代。

### 外部 Skill 参考

本项目不安装外部 GitHub skills，只参考其评测和 Prompt 优化思路：

- `eval-audit` / `write-judge-prompt`：用于把主观质量拆成可判定评测项。
- `skill-optimizer`：用于检查技能/指令是否过长、触发条件是否清晰。
- `advanced-evaluation`：用于设计多轮评测和 bad case 复盘流程。
