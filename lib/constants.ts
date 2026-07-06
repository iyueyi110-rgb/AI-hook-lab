import type { Platform, ContentType, EmotionTone } from "./types";

export const PLATFORM_CONFIG: Record<
  Platform,
  { label: string; emoji: string; description: string }
> = {
  xiaohongshu: {
    label: "小红书",
    emoji: "📕",
    description: "种草社区，真实分享感，闺蜜聊天语气，重视视觉美感和生活品质",
  },
  douyin: {
    label: "抖音",
    emoji: "🎵",
    description: "短视频王者，前三秒抓注意力，节奏快、情绪强、接地气",
  },
  bilibili: {
    label: "B站",
    emoji: "📺",
    description: "Z世代聚集地，弹幕文化，内容深度与趣味并存，圈层梗多",
  },
  youtube: {
    label: "YouTube",
    emoji: "▶️",
    description: "全球长视频平台，标题信息量大，封面+标题组合拳，SEO驱动",
  },
  x: {
    label: "X",
    emoji: "𝕏",
    description: "观点广场，短小犀利，热点驱动，一句话定生死，适合金句和挑衅式表达",
  },
};

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: string }
> = {
  video: { label: "视频", icon: "🎬" },
  "image-text": { label: "图文", icon: "📝" },
  "product-ad": { label: "产品广告", icon: "📦" },
  tutorial: { label: "教程", icon: "📖" },
  opinion: { label: "观点帖", icon: "💡" },
};

// 10 styles mapped per platform — each platform gets its own flavor
export const PLATFORM_STYLES: Record<Platform, string[]> = {
  xiaohongshu: [
    "闺蜜安利型",
    "真实体验型",
    "避坑指南型",
    "干货清单型",
    "前后对比型",
    "情绪共鸣型",
    "悬念揭秘型",
    "省钱攻略型",
    "仪式感型",
    "冷门宝藏型",
  ],
  douyin: [
    "前3秒冲击型",
    "反常识型",
    "痛点扎心型",
    "情绪爆发型",
    "挑战型",
    "数据震撼型",
    "神转折型",
    "代入感型",
    "悬念型",
    "金句收尾型",
  ],
  bilibili: [
    "弹幕互动型",
    "硬核拆解型",
    "玩梗型",
    "科普反差型",
    "圈层暗号型",
    "测评型",
    "二创改编型",
    "弹幕预言型",
    "学术降维型",
    "社死现场型",
  ],
  youtube: [
    "搜索结果型",
    "好奇心缺口型",
    "案例故事型",
    "步骤承诺型",
    "权威背书型",
    "对比测试型",
    "趋势解读型",
    "争议观点型",
    "资源合集型",
    "经验分享型",
  ],
  x: [
    "锋利观点型",
    "金句型",
    "反共识型",
    "数据打脸型",
    "极简提问型",
    "亲身经历型",
    "挑衅型",
    "一句话总结型",
    "二选一型",
    "热点借势型",
  ],
};

// Color mapping for style badges — 10 colors cycle
export const STYLE_COLORS = [
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-sky-100 text-sky-800",
  "bg-teal-100 text-teal-800",
  "bg-orange-100 text-orange-800",
  "bg-indigo-100 text-indigo-800",
  "bg-red-100 text-red-800",
  "bg-slate-200 text-slate-800",
  "bg-emerald-100 text-emerald-800",
  "bg-fuchsia-100 text-fuchsia-800",
];

export const EMOTION_TONE_CONFIG: Record<
  EmotionTone,
  { label: string; icon: string; description: string }
> = {
  urgent: {
    label: "紧迫感",
    icon: "⚡",
    description: "制造立即行动的时间压力，但避免夸张恐吓",
  },
  curious: {
    label: "好奇心",
    icon: "🔍",
    description: "制造信息缺口，引导继续阅读或观看",
  },
  humorous: {
    label: "幽默",
    icon: "😄",
    description: "用轻松反差降低阅读门槛，适合生活化表达",
  },
  emotional: {
    label: "情绪共鸣",
    icon: "💭",
    description: "强调用户身份、处境和真实感受",
  },
  authoritative: {
    label: "权威",
    icon: "📌",
    description: "突出经验、方法论、案例和可信度",
  },
  rebellious: {
    label: "反常识",
    icon: "🔥",
    description: "通过反直觉观点制造讨论欲和停留欲",
  },
};
