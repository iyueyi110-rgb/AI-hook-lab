# AI Hook Lab

> Creative Coach Agent setup, API, retention, safety, evaluation, and rollout: [docs/creative-coach-agent.md](docs/creative-coach-agent.md). Classic 10-Hook generation remains available when the feature flag is disabled.

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

### 一键启动（macOS）

在 Finder 中双击项目根目录下的 `start-ai-hook-mac.command`。

启动器会自动：

- 检查 Node.js、npm、curl 和 lsof
- 首次运行时安装依赖
- 从 `.env.local.example` 创建 `.env.local`
- 优先使用 3000，并在占用时依次检查 3010、3011、3012、3020
- 等待服务可访问后，同时打开 AI Hook 首页和管理员后台 `/admin/dashboard`
- 检测并复用已经运行的 AI Hook 服务，避免重复启动

第一次运行前，建议在 `.env.local` 中填写：

```bash
DEEPSEEK_API_KEY=your_api_key_here
```

本地开发时，`DATABASE_URL` 和 `EVAL_INGEST_TOKEN` 为可选项。没有 `DATABASE_URL` 时，看板和评测系统使用项目目录内的 JSON 文件降级存储；这些本地数据库或 JSON 文件不会对公网暴露。

如果 macOS 提示没有执行权限，在项目目录运行一次：

```bash
chmod +x start-ai-hook-mac.command
```

如果系统阻止首次打开，可在 Finder 中按住 Control 点击文件，选择“打开”，再确认一次。终端会显示最终使用的端口；按 `Control+C` 可以停止由本次启动器创建的服务。若启动器复用了已有服务，关闭启动器不会停止原服务。

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
http://localhost:3001/admin/dashboard
```

首次使用先打开 `/evaluation/login?next=/admin/dashboard` 创建第一个管理员，登录后即可进入受保护的数据看板。看板区分真实操作、评测集和模拟数据来源，并将模型自评分与人工平台满意度分开，模型分不代表真实点击效果。

本地环境的看板事件优先写入 `DATABASE_URL` 指向的 PostgreSQL；未配置数据库时才降级到 `data/dashboard-events.json`。生产环境使用 Vercel Marketplace 提供的 Neon PostgreSQL，必须配置 `DATABASE_URL`，不使用 JSON 降级存储。

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

打开 [http://localhost:3001/admin/dashboard](http://localhost:3001/admin/dashboard) 查看数据看板。如尚未创建管理员，先访问 [http://localhost:3001/evaluation/login?next=/admin/dashboard](http://localhost:3001/evaluation/login?next=/admin/dashboard)。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
```

## 评测命令

完整离线评测系统位于：

```bash
http://localhost:3000/evaluation
```

首次使用先初始化存储和 60 条固定案例：

```bash
npm run eval:migrate
npm run eval:seed
```

随后打开 `/evaluation/login?next=/admin/dashboard` 创建首个管理员，再创建两名评测员和一名裁决员。系统支持 PostgreSQL 正式存储及仅限本地开发的 JSON 降级、Prompt 不可变版本、360 条候选生成、120 条正式结果、双人独立评分、60 案例 A/B 盲评、第三人裁决、Bad Case 复盘和七类导出。

无 API Key 时必须显式选择 Mock 模式。Mock 数据会明显标注且不能形成 Prompt 升级结论。完整操作说明见 [docs/evaluation-system.md](docs/evaluation-system.md)。

### API Smoke Test

启动开发服务后，可以运行小样本评测：

```bash
node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0
```

旧脚本默认对同一主题和平台成对运行 `baseline/candidate`，仅用于接口 Smoke Test，不替代完整人工评测：

```bash
node eval/run-eval.mjs
npm run eval:summarize
```

## 环境变量

| 名称 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，用于服务端生成 Hook |
| `DATABASE_URL` | PostgreSQL 连接串；生产环境必填（Vercel Marketplace Neon），仅本地开发可留空并使用 JSON 降级 |
| `EVAL_INGEST_TOKEN` | 评测脚本写入 `evaluation_set` 来源事件的共享令牌 |

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
