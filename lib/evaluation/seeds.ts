import type { EvaluationCase, EvaluationPlatform } from "./types.ts";

const CREATED_AT = "2026-07-13T00:00:00.000Z";

const TOPICS = [
  ["普通人如何理解大语言模型", "知识科普", "AI 入门普通用户"],
  ["为什么手机电池会老化", "知识科普", "重度手机用户"],
  ["建筑为什么需要自然通风", "知识科普", "关注居住品质的普通用户"],
  ["新手如何学习摄影参数", "知识科普", "摄影新手"],
  ["实习生第一次做需求分析", "职场成长", "产品实习生"],
  ["产品经理如何整理用户反馈", "职场成长", "初级产品经理"],
  ["跨专业转行如何做作品集", "职场成长", "跨专业求职者"],
  ["面试时如何介绍个人项目", "职场成长", "应届与转行求职者"],
  ["租房时容易忽略的问题", "生活经验", "首次租房青年"],
  ["如何控制冲动消费", "生活经验", "学生与职场新人"],
  ["周末低成本放松方式", "生活经验", "城市青年"],
  ["提高睡前效率的小习惯", "生活经验", "作息不规律人群"],
  ["一万元游戏本怎么选", "测评推荐", "一万元预算玩家"],
  ["入门相机镜头怎么选", "测评推荐", "相机入门用户"],
  ["AI 写作工具对比", "测评推荐", "内容创作者与学生"],
  ["学生党效率软件推荐", "测评推荐", "在校学生"],
  ["第一次实习失败后的反思", "情绪与故事", "实习生与应届生"],
  ["建筑学生熬夜赶图的一天", "情绪与故事", "建筑专业学生"],
  ["异地恋中容易忽视的沟通问题", "情绪与故事", "异地恋情侣"],
  ["从建筑转向 AI 产品经理的经历", "情绪与故事", "建筑背景转行者"],
] as const;

const PLATFORM_RULES: Record<EvaluationPlatform, {
  code: string;
  label: string;
  emotionStyle: string;
  lengthLimit: number;
}> = {
  xiaohongshu: { code: "XHS", label: "小红书", emotionStyle: "生活化、经验分享、情绪价值", lengthLimit: 60 },
  douyin: { code: "DY", label: "抖音", emotionStyle: "口语化、直接、结果或冲突前置", lengthLimit: 45 },
  bilibili: { code: "BILI", label: "B站", emotionStyle: "问题导向、知识密度、过程分析", lengthLimit: 70 },
};

export const EVALUATION_DATASET_VERSION = "hook-eval-v1";

export const EVALUATION_CASES: EvaluationCase[] = TOPICS.flatMap(
  ([topic, category, targetAudience], topicIndex) =>
    (Object.entries(PLATFORM_RULES) as Array<[EvaluationPlatform, (typeof PLATFORM_RULES)[EvaluationPlatform]]>)
      .map(([platform, rule]) => {
        const topicNumber = String(topicIndex + 1).padStart(3, "0");
        const caseId = `CASE_${topicNumber}_${rule.code}`;
        return {
          id: caseId,
          caseId,
          datasetVersion: EVALUATION_DATASET_VERSION,
          topicId: `TOPIC_${topicNumber}`,
          topic,
          category,
          platform,
          platformLabel: rule.label,
          targetAudience,
          emotionStyle: rule.emotionStyle,
          lengthLimit: rule.lengthLimit,
          dataOrigin: "evaluation_set" as const,
          status: "active" as const,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
      }),
);

export function validateCanonicalCases(cases: EvaluationCase[]): string[] {
  const errors: string[] = [];
  if (cases.length !== 60) errors.push("Canonical evaluation dataset must contain exactly 60 cases");
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) errors.push("caseId must be unique");
  if (new Set(cases.map((item) => item.topicId)).size !== 20) errors.push("Dataset must contain exactly 20 topics");
  for (const topicId of new Set(cases.map((item) => item.topicId))) {
    const platforms = new Set(cases.filter((item) => item.topicId === topicId).map((item) => item.platform));
    if (platforms.size !== 3) errors.push(`${topicId} must contain three platforms`);
  }
  if (cases.some((item) => item.dataOrigin !== "evaluation_set")) errors.push("All cases must use evaluation_set origin");
  return errors;
}

