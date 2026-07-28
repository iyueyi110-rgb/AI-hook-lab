# AI Hook Lab｜AIGC 创作与评测工作台

## 产品定位

AI Hook Lab 面向中文内容创作者与内容运营团队，把结构化创作简报、多版本 Hook 生成、人工反馈、离线评测和运营分析连接成可复核的内容优化闭环。首页以统一创作台承载快速生成和按需介入的创作 Agent，并提供只读运营分析 Agent、图片理解和 Prompt 评测工作台。

本人把它作为 AI 产品经理作品集：重点展示问题定义、产品规则、指标口径、安全边界与版本决策，而不是把模型输出或模拟数据包装成真实业务结果。

## 快速入口

- 在线 Demo 状态：公网自动请求返回 200，但手机流量、无痕浏览器与桌面交互尚未完成人工验收，因此暂不作为公开入口。详见 [Demo 验证记录](docs/portfolio/demo-verification.md)。
- [创作 Agent](docs/creative-agent.md)：查看简报补全、候选生成、人工确认、状态恢复与安全约束。
- [运营分析 Agent](docs/portfolio/operations-agent.md)：查看只读工具、证据引用和人工升级门槛。
- [受治理策略桥接层](docs/strategy-governance.md)：查看策略版本、证据门禁、创作绑定和观察性分析边界。
- [60 个固定案例与评测方法](docs/evidence/README.md)：20 个主题 × 3 个平台，用于复核评测流程，不代表真实用户效果。
- [数据存储与安全边界](SECURITY.md)：查看生产存储、权限、配额、密钥扫描和依赖审计说明。
- [一页产品策略](docs/product/product-strategy.md)：查看北极星指标、竞品事实矩阵与分阶段路线图。
- [作品集验收与简历对齐记录](docs/portfolio/acceptance-and-resume-alignment.md)：查看证据分级、门禁结果字段和未验证主张的同步规则。

## 本人与 AI 的分工

| 环节 | 本人负责 | AI 协助 | 本人如何验收与决策 |
| --- | --- | --- | --- |
| 问题定义 | 用户、场景、优先级与证据边界 | 整理访谈或测试摘要、备选假设 | 核对真实样本与业务边界，决定保留或否决假设 |
| 产品规则 | 流程、状态、异常、人工审核与升级门槛 | 生成文档、代码和测试初稿 | 使用状态机、异常用例和安全边界验收 |
| 原型与代码 | 交互要求、接口契约和验收标准 | 搭建页面、接口、测试与重构代码 | 本地运行、复现 Bad Case，并决定是否合并 |
| 数据结论 | 指标口径、来源隔离、护栏与版本决策 | 计算、聚合和报告草稿 | 核对分子分母、原始记录和反证，决定是否升级 |

更完整的协作记录见 [本人判断与 AI 协作边界](docs/portfolio/ai-collaboration.md)。AI 不代替本人定义问题、确认事实、解释用户证据或批准版本发布。

## 验证与版本决策

- 固定评测集只比较可复现的 Prompt 与工作流表现；Mock、模型自评分和未完成评测不进入升级结论。
- 创作 Agent 的候选生成、改写与最终确认由确定性测试覆盖；运营分析 Agent 只能读取聚合数据和证据引用，不能改 Prompt、发版本或发送消息。
- 正式升级必须同时满足指标口径一致、数据来源可追溯、人工盲评完成、Bad Case 无新增高风险和安全门禁通过。
- 当前可公开复核的是 20 个主题 × 3 个平台的 60 个固定案例、评测方法、测试代码与安全规则；它们证明方法和实现，不证明真实传播效果。

## 证据边界

- 真实用户、离线评测与模拟数据使用独立来源标识，不跨来源合并百分比。
- 缺少脱敏原始记录、整数分子分母或正式导出的结果性主张，一律标记为未验证并从公开结论中移除。
- 收藏、采用、点击或传播等词必须按 [指标字典](docs/evidence/metrics-dictionary.md) 使用；模型评分只用于解释和排序候选。
- 主张状态、缺失材料和恢复条件见 [公开证据索引](docs/evidence/README.md) 与 [主张审计](docs/evidence/claims-audit.md)。

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 经典生成 | 输入主题、平台、内容类型、目标用户、情绪风格和字数限制，一次生成 10 条不同风格的 Hook |
| 多平台适配 | 支持小红书、抖音、B 站、YouTube 和 X，针对不同平台采用不同的表达策略 |
| 结果解释 | 提供冲击力、平台匹配、可操作性、传播力等模型评分，以及推荐理由、整体分析和 Bad Case 标签 |
| 创作资产 | 支持复制、收藏、标记采用、平台满意度反馈，以及浏览器本地历史记录 |
| 图片理解 | 上传截图或图片，自动提取主题、图片描述，并建议平台、内容类型和情绪风格 |
| 创作 Agent | 通过对话补全创作简报、生成候选、筛选 Top 3、按反馈改写并进行最终确认 |
| 数据看板 | 按真实用户、离线评测和模拟数据来源查看生成健康度、内容价值与人工反馈 |
| 离线评测 | 使用固定案例对比 baseline 与 candidate Prompt，支持双人盲评、A/B 对比、第三人裁决、Bad Case 复盘和报告导出 |
| 运营分析 Agent | 管理员通过只读工具查询看板和评测证据，获得带来源引用的发现、风险和 Prompt 优化建议 |

## 创作路径

### 经典生成

“生成 10 个候选”使用 `/api/generate` 完成单次生成，适合主题已经明确、希望快速获取和比较多个开头方案的用户。

- 5 个内容平台：小红书、抖音、B 站、YouTube、X
- 5 类内容：视频、图文、产品广告、教程、观点帖
- 6 种可选情绪：紧迫、好奇、幽默、情绪共鸣、权威、反常识
- 每次严格返回 10 条候选，并展示模型判断与推荐理由
- 历史记录、收藏和采用状态保存在当前浏览器的 `localStorage`
- 创作者反馈以聚合、白名单字段写入看板，不把模型分数当作真实点击率

### 创作 Agent

设置 `NEXT_PUBLIC_AGENT_COACH_ENABLED=true` 后，首页会显示“帮我梳理”和“继续打磨”入口。Agent 默认隐藏；用户主动启用后才从右侧展开，并自动携带当前创作简报。经典候选进入 Agent 时会经过严格的候选转换边界，执行路径仍与 `/api/generate` 分离。

创作 Agent 采用受约束的单 Agent 工作流：

1. 根据对话补全结构化创作简报，最多连续追问 2 个缺失项。
2. 确认简报后生成 10 条候选，并给出稳定的 Top 3。
3. 支持单条改写或整批重生成，最多进行 3 轮用户可见修改。
4. 用户选择候选后，需要单独执行最终确认才会完成并写入历史。
5. 页面刷新后可恢复当前任务；并发写入通过 `expectedRevision` 防止旧请求覆盖新状态。

长期记忆只保存平台、风格偏好、情绪、字数区间和规避标签等白名单偏好，不保存主题、Hook、自由文本、图片或个人身份信息。详细设计见 [创作 Agent 文档](docs/creative-agent.md)。

### 图片理解

创作台可使用火山引擎 Ark 视觉模型理解图片，结构化图片描述会随共享简报进入所选执行路径。

- 支持 JPEG、PNG、WebP
- 单张图片不超过 5 MB
- 需要同时配置 `ARK_API_KEY` 和 `ARK_MODEL_ID`
- 原始图片及其 Base64 内容不会持久化
- 只保存经过校验的结构化图片描述，并允许用户在生成前修改或确认

### 管理后台与运营分析 Agent

管理员登录后可访问：

- `/admin/dashboard`：查看生成健康度、内容价值、人工反馈、Bad Case 和数据来源分布
- `/admin/dashboard/agent`：用自然语言查询看板、评测批次、Prompt 版本和 Bad Case 证据
- `/admin/dashboard/strategies`：审核、评测、激活、归档和比较不可变策略版本

运营分析 Agent 仅提供组织级只读工具，不会修改 Prompt、发布版本、写入评测结果或发送消息。数字结论必须关联数据来源；模拟数据和未完成评测不能形成正式升级结论。该功能由 `OPS_AGENT_ENABLED` 控制，开发环境默认开启，生产环境默认关闭。

## 快速开始

### 环境要求

- Node.js `>= 22.6.0`（CI 使用 24.x）
- npm
- DeepSeek API Key（实时生成和 Agent 能力需要）
- PostgreSQL（生产环境必须；本地开发可使用 JSON 存储）

### 手动启动

```bash
npm install
```

复制环境变量模板：

```bash
# macOS / Linux
cp .env.local.example .env.local

# Windows PowerShell
Copy-Item .env.local.example .env.local
```

至少填写：

```dotenv
DEEPSEEK_API_KEY=your_api_key_here
```

启动开发服务：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

### Windows 一键启动

- 双击 `tools/start-ai-hook-lab.bat`：安装缺失依赖、创建 `.env.local`、本地化 Next.js 开发工具并打开首页
- 双击 `tools/start-ai-hook-dashboard.bat`：在 3001 端口启动应用并打开管理后台

后台也可以直接使用已运行的前端服务访问：

```text
http://localhost:3000/admin/dashboard
```

### macOS 一键启动

在 Finder 中双击 `tools/start-ai-hook-mac.command`。启动器会从 `tools/` 定位仓库根目录，检查依赖、创建 `.env.local`、寻找可用端口，并同时打开首页和管理后台。

如果文件没有执行权限：

```bash
chmod +x tools/start-ai-hook-mac.command
```

## 账号与页面入口

| 地址 | 用途 | 权限 |
| --- | --- | --- |
| `/` | Hook 创作工作台 | 公开 |
| `/evaluation/login` | 评测系统登录与首次管理员初始化 | 公开 |
| `/evaluation` | Prompt 离线评测工作台 | 已登录评测用户 |
| `/admin/dashboard` | 运营数据看板 | 管理员 |
| `/admin/dashboard/agent` | 运营分析 Agent | 管理员且功能已开启 |

首次使用评测系统时，打开 `/evaluation/login` 创建第一个管理员。管理员可以继续创建 `admin`、`evaluator` 和 `adjudicator` 角色账号。

## 环境变量

完整模板见 [.env.local.example](.env.local.example)。真实密钥只能放在被 Git 忽略的 `.env.local` 中。

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 实时生成必需 | Hook 生成、创作 Agent 和运营分析 Agent 使用的 DeepSeek Key |
| `DATABASE_URL` | 生产必需 | PostgreSQL 连接串；本地留空时使用 JSON 存储，生产环境留空会拒绝提供相关服务 |
| `EVALUATION_STORE_PATH` | 否 | 覆盖本地评测 JSON 文件路径 |
| `PUBLIC_DASHBOARD_ENABLED` | 否 | 设为 `true` 时仅公开只读数据看板；其他后台、Agent 和写入接口仍需原权限 |
| `AGENT_STORE_PATH` | 否 | 覆盖本地创作 Agent JSON 文件路径 |
| `EVAL_INGEST_TOKEN` | 按需 | 评测脚本写入 `evaluation_set` 来源事件时使用 |
| `ARK_API_KEY` | 图片理解必需 | 火山引擎 Ark API Key |
| `ARK_MODEL_ID` | 图片理解必需 | 已开通的 Ark 模型或推理接入点 ID |
| `NEXT_PUBLIC_AGENT_COACH_ENABLED` | 否 | 设置为 `true` 后开放创作 Agent 界面和 API |
| `AGENT_CLEANUP_TOKEN` | 生产建议配置 | 调用 Agent 数据清理接口时使用的 Bearer Token |
| `OPS_AGENT_ENABLED` | 否 | 控制管理员运营分析 Agent；生产环境需显式设为 `true` |
| `STRATEGY_CARDS_ENABLED` | 否 | 控制新策略查询和新 Agent 绑定；关闭后已绑定运行仍可完成 |
| `AGENT_IP_HASH_SECRET` | 生产必需 | 用于匿名配额 IP HMAC，建议使用至少 32 位独立高熵随机值 |
| `AGENT_TRUSTED_IP_HEADER` | 否 | 由可信部署代理覆盖的客户端 IP 请求头，默认 `x-vercel-forwarded-for` |
| `AGENT_QUOTA_*` | 否 | 调整会话/IP 运行次数、模型调用、图片调用和活跃任务配额 |
| `CLASSIC_QUOTA_WINDOW_SECONDS` | 否 | 经典生成 IP 配额窗口，默认 3600 秒 |
| `CLASSIC_QUOTA_IP_GENERATIONS` | 否 | 每个 IP 在窗口内的经典生成次数，默认 20 次 |

## 数据存储与安全边界

- 本地开发：看板、评测、创作 Agent 和运营 Agent 可分别使用 `data/` 下的 JSON 文件。
- 生产环境：必须配置 PostgreSQL；系统不会回退到本地 JSON，以避免多实例下的数据丢失和不一致。
- 经典历史与收藏：只保存在当前浏览器，不会自动跨设备同步。
- 数据来源：严格区分 `real_user`、`evaluation_set` 和 `simulation`，避免把模拟或离线数据解释为真实用户行为。
- Agent 所有权：创作 Agent 使用 HttpOnly 匿名会话 Cookie，服务端只保存摘要；运营 Agent 会话按管理员隔离。
- 数据保留：创作 Agent 非活跃任务最长保留 30 天，匿名会话最长 180 天；生产环境应定时调用受保护的清理接口。
- 配额防护：生产环境通过会话和 HMAC 后的 IP 摘要限制付费模型操作，不存储原始 IP。
- 密钥扫描：提交前可运行 `npm run security:scan`；扫描只报告文件、行号和规则，不打印匹配值。

## 生产部署检查

- `DATABASE_URL` 已配置 PostgreSQL；生产不会回退到本地 JSON。
- `AGENT_IP_HASH_SECRET` 使用独立随机值，长度至少 32 个字符，不能是 `replace_me`。
- `AGENT_TRUSTED_IP_HEADER` 由可信反向代理覆盖；不要直接信任用户可控的通用转发头。
- `AGENT_CLEANUP_TOKEN` 若启用定时清理，必须替换占位值并通过部署密钥管理注入。
- `DEEPSEEK_API_KEY`、`ARK_API_KEY` 和数据库凭据只存在于服务端环境变量，不进入仓库或浏览器。
- 部署后依次验证首页、`/api/generate`、限流 429、错误态和管理员只读权限。

## 离线评测

评测系统使用 20 个固定主题和 3 个平台组成 60 条固定案例，对比 baseline 与 candidate Prompt。它支持不可变 Prompt 版本、Live/Mock 运行、双人独立评分、A/B 盲评、第三人裁决、Bad Case 分析和七类结果导出。

`lib/evaluation/` 是产品内的评测领域逻辑与工作台能力，`eval/*.mjs` 是共享同一套 60 个固定案例的命令行冒烟和批处理入口。

初始化本地存储与固定案例：

```bash
npm run eval:migrate
npm run eval:seed
```

运行一个 API Smoke Test：

```bash
node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0
```

运行命令行批量评测并汇总：

```bash
npm run eval:run
npm run eval:summarize
```

运行创作 Agent 的确定性验收套件：

```bash
npm run eval:agent
```

Mock 和子集运行只能验证流程，不能形成 Prompt 升级结论。完整规则见 [离线评测系统文档](docs/evaluation-system.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run build` | 创建生产构建 |
| `npm run start` | 启动生产构建 |
| `npm run lint` | 运行 ESLint |
| `npm test` | 运行完整 Node 测试套件 |
| `npm run docs:check` | 检查已跟踪 Markdown 的中文公开规范 |
| `npm run eval:agent` | 运行创作 Agent 验收测试 |
| `npm run security:scan` | 扫描 Git 跟踪文件中的凭据风险 |
| `npm run eval:migrate` | 初始化或迁移评测存储 |
| `npm run eval:seed` | 写入固定评测案例 |

提交前建议执行：

```bash
npm test
npm run docs:check
npm run lint
npm run build
npm run security:scan
```

## 技术栈

- Next.js 16（App Router）
- React 19
- TypeScript
- Tailwind CSS 4
- PostgreSQL / 本地 JSON 双存储适配
- DeepSeek 文本模型
- 火山引擎 Ark 视觉模型
- Node.js 原生测试运行器

## 项目结构

```text
app/                    页面与 Route Handlers
components/             创作台、抽屉、看板和 Agent 组件
hooks/                  历史、收藏、分析与创作 Agent 状态
lib/generation/         Hook 生成与结构化输出校验
lib/agent/              创作 Agent、运营 Agent、配额和持久化
lib/evaluation/         离线评测领域逻辑、权限、报告与导出
lib/strategy/           策略卡、证据门禁、审核、绑定和双存储仓储
db/migrations/          PostgreSQL 评测系统迁移
eval/                   评测脚本与结果模板
scripts/                密钥扫描与本地开发辅助脚本
tools/                  Windows 与 macOS 一键启动器
docs/product/           产品策略、业务闭环与治理说明
docs/evidence/          公开证据、主张审计与指标权威口径
docs/portfolio/         招聘方入口、AI 协作边界与 Demo 记录
```

## 进一步阅读

- [创作 Agent：架构、安全、评测与发布](docs/creative-agent.md)
- [离线评测系统说明](docs/evaluation-system.md)
- [运营分析 Agent](docs/portfolio/operations-agent.md)
- [受治理策略桥接层](docs/strategy-governance.md)
- [策略卡管理员操作手册](docs/strategy-admin-guide.md)
- [策略卡故障 Runbook](docs/strategy-runbook.md)
- [公开证据索引](docs/evidence/README.md)
- [真实创作者验证计划](docs/product/real-user-validation-plan.md)
- [AI 治理说明](docs/product/ai-governance.md)
- [证据指标字典](docs/evidence/metrics-dictionary.md)
- [业务闭环](docs/product/business-chain.md)

## 说明

模型评分用于解释和排序候选，不等于真实点击率、收藏率或传播效果。当前只公开可复核的 60 个固定案例与评测方法，缺少脱敏原始记录的结果性数字不对外使用。正式的 Prompt 升级判断应以完整离线评测、人工盲评和明确的数据来源为依据。
