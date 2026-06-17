import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Hook Lab — AI 爆款 Hook 生成器",
  description:
    "输入主题，选择平台和内容类型，AI 一次生成 10 个不同风格的爆款开头 Hook。支持小红书、抖音、B站、YouTube、X。",
  keywords: ["AI", "Hook", "文案", "爆款", "生成器", "小红书", "抖音", "内容创作"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-white text-gray-900 font-sans">
        {children}
      </body>
    </html>
  );
}
