# 安全说明

## 当前依赖审计

2026-07-10 执行 `npm audit --omit=dev`，报告 Next.js 内置 PostCSS 的 2 个中风险传递漏洞（`GHSA-qx2v-qp2m-jg93`）。当前自动修复方案会强制安装 Next.js 9.3.3，破坏现有 Next.js 16 App Router，因此不执行 `npm audit fix --force`。

当前缓解：应用不把用户输入拼接为 CSS 或 `<style>` 内容；主题、平台与模型输出只作为文本渲染；生产发布前继续运行审计。待 Next.js 发布包含已修复 PostCSS 的兼容版本后，先在独立分支升级并通过测试、lint 和生产构建，再合并。

## 数据与密钥

- `DEEPSEEK_API_KEY`、`DATABASE_URL`、`EVAL_INGEST_TOKEN` 只配置在服务端环境变量。
- 公开事件接口限制 payload 大小；未通过评测令牌校验的事件不能标记为 `evaluation`。
- 模型输出不是可信代码或真实效果数据，必须经过结构校验和人工判断。
