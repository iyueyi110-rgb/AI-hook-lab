# 安全说明

## 当前依赖审计

2026-07-27 复核 `npm audit --omit=dev`：将 Next.js 从 `16.2.9` 升级至当前补丁版 `16.2.12` 后，Next.js 本体的已知公告不再出现在审计结果中；仍有 3 个高危依赖项记录，集中在 Next.js 传递依赖 PostCSS 与 Sharp。

- PostCSS：涉及未转义样式输出、`sourceMappingURL` 文件读取和路径遍历公告。应用不把用户输入拼接为 CSS、`<style>` 或 source map，主题、平台与模型输出只作为文本渲染。
- Sharp：涉及其继承的 libvips 漏洞。当前图片入口限制 MIME、文件签名和 5 MB 大小，原始图片不持久化，也不接受用户提供的服务器文件路径。
- 自动修复会把 Next.js 降级为 `9.3.3`，破坏现有 Next.js 16 App Router，因此禁止执行 `npm audit fix --force`。

生产发布前必须继续运行依赖审计。待 Next.js 发布同时兼容已修复 PostCSS 与 Sharp 的版本后，在独立分支升级，并通过测试、lint、构建、图片上传边界和安全扫描后再合并。

## 数据与密钥

- `DEEPSEEK_API_KEY`、`DATABASE_URL`、`EVAL_INGEST_TOKEN` 只配置在服务端环境变量。
- 公开事件接口限制 payload 大小；未通过评测令牌校验的事件不能标记为 `evaluation`。
- 模型输出不是可信代码或真实效果数据，必须经过结构校验和人工判断。
