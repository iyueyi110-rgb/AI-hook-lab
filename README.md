# AI Hook Lab

AI Hook Lab 是一个面向内容创作者的爆款 Hook 生成工具。输入主题、平台和内容类型后，应用会调用 DeepSeek 生成 10 个不同风格的开头文案，并支持历史记录与收藏。

## 功能

- 支持小红书、抖音、B 站、YouTube、X 等平台
- 支持视频、图文、产品广告、教程、观点帖等内容类型
- 每次生成 10 条不同风格的 Hook
- 本地保存生成历史和收藏
- 支持一键复制单条或全部 Hook

## 本地运行

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

## 常用命令

```bash
npm run dev
npm run lint
npm run build
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
