import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "离线评测 | AI Hook Lab",
  description: "基于固定案例、双人评分与 A/B 盲评判断 Prompt 是否值得升级。",
};

export default function EvaluationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
