# AI Hook Lab macOS 一键启动器设计

## 目标

在项目根目录提供可由 Finder 双击运行的 `start-ai-hook-mac.command`。启动器只启动一个 Next.js 开发服务，并在服务可访问后自动打开 AI Hook 首页和 `/dashboard` 两个浏览器标签页。

## 用户路径

1. 用户首次双击 `start-ai-hook-mac.command`。
2. 脚本切换到自身所在的项目目录，避免 Finder 启动目录不确定。
3. 脚本检查 `node` 和 `npm`。任一缺失时显示 Node.js 安装地址并停止。
4. `node_modules` 不存在时执行 `npm install`；安装失败则显示错误并停止。
5. `.env.local` 不存在时，从 `.env.local.example` 创建，并使用 TextEdit 打开。应用仍可启动，但生成 Hook 前必须填写 `DEEPSEEK_API_KEY`。
6. 脚本从 3000 开始查找可用端口；若被占用，依次检查 3010、3011、3012，最后检查 3020。全部占用时停止并说明原因。
7. 脚本运行 `npm run dev -- -p <port>`。
8. 后台探测 `http://localhost:<port>`；服务返回 HTTP 响应后，使用 macOS `open` 命令依次打开首页和 `/dashboard`。
9. 终端保留服务器日志。用户按 `Control+C` 后，等待服务器进程退出并结束脚本。

## 文件范围

- 新增 `start-ai-hook-mac.command`：用户双击入口。
- 新增 `.env.local.example`：只包含环境变量名称和安全占位值，不包含真实密钥。
- 新增脚本契约测试：静态检查目录切换、依赖检查、环境初始化、端口选择、健康探测、双页面打开和退出处理。
- 更新 `README.md`：增加 macOS 使用方法、首次运行权限处理和故障排查。

不修改 Hook 生成逻辑、Prompt、数据库结构或 Windows 启动器。

## 端口策略

端口是否可用使用 macOS 自带的 `lsof` 检查。候选顺序固定为：

```text
3000 → 3010 → 3011 → 3012 → 3020
```

固定顺序便于用户理解和排查，也避免随机端口导致书签和评测命令难以复用。脚本必须在终端明确打印最终 URL。

## 环境配置

`.env.local.example` 包含：

```text
DEEPSEEK_API_KEY=
DATABASE_URL=
EVAL_INGEST_TOKEN=
```

只有 `DEEPSEEK_API_KEY` 是生成 Hook 的必要配置。`DATABASE_URL` 未配置时，数据看板沿用本地文件降级；`EVAL_INGEST_TOKEN` 仅在运行评测脚本时使用。

脚本不能读取、打印或上传环境变量值。

## 错误处理

- Node/npm 缺失：显示 `https://nodejs.org/` 并退出非零状态。
- 依赖安装失败：保留 npm 原始错误，显示中文总结并退出。
- 环境模板缺失：创建最小安全模板，不写入任何真实 Key。
- 所有候选端口被占用：列出检查过的端口并退出。
- 服务在 30 秒内未响应：继续保留服务器日志，不自动打开浏览器，并提示用户检查终端错误。
- 用户按 `Control+C`：转发中断信号给 Next.js 进程，避免后台残留服务。

## 测试与验收

自动检查：

- 脚本通过 `bash -n` 语法检查。
- 契约测试确认必要命令和安全约束存在。
- 项目原有 `npm test`、`npm run lint` 和 `npm run build` 继续通过。

人工验收：

1. Finder 双击后终端正常打开。
2. 首次运行能创建 `.env.local` 并打开 TextEdit。
3. 缺少 API Key 时页面仍能打开，生成操作显示明确配置提示。
4. 3000 空闲时首页为 `http://localhost:3000`。
5. 3000 被占用时自动使用下一个候选端口。
6. 浏览器同时打开首页和 `/dashboard`。
7. `Control+C` 后对应端口不再监听。

## 提交策略

设计文档和功能实现分开提交。功能提交只包含启动器、环境模板、测试和 README，便于在 VS Code 中逐步审查和回退。
