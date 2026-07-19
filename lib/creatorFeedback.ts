export const ANONYMOUS_CREATOR_STORAGE_KEY = "ai-hook-lab-anonymous-creator-id";

export type CreatorFeedbackTrigger =
  | "adoption"
  | "explicit_batch_reject"
  | "sampled_before_regenerate"
  | "low_satisfaction";

export type FeedbackUsageOutcome =
  | "direct_use"
  | "light_edit"
  | "heavy_rewrite"
  | "reference_only";

export type FeedbackReasonTag =
  | "not_relevant"
  | "too_generic"
  | "platform_mismatch"
  | "tone_mismatch"
  | "length_mismatch"
  | "weak_reasoning"
  | "clickbait_risk"
  | "repetitive"
  | "hard_to_execute"
  | "other";

export interface CreatorFeedbackRequest {
  promptId: string;
  trigger: CreatorFeedbackTrigger;
  scope: "hook" | "batch";
  anonymousCreatorId: string;
  taskId: string;
  hookId?: string;
  platform?: string;
  contentType?: string;
  templateVersion?: string;
  promptVariant?: string;
  clickScore?: number;
  modelBadcaseTags?: string[];
}

export interface CreatorFeedbackSubmission {
  usageOutcome?: FeedbackUsageOutcome;
  reasonTags: FeedbackReasonTag[];
  comment?: string;
}

export const FEEDBACK_USAGE_OUTCOMES: ReadonlyArray<{
  value: FeedbackUsageOutcome;
  label: string;
  description: string;
}> = [
  { value: "direct_use", label: "直接使用", description: "基本不需要修改" },
  { value: "light_edit", label: "小幅修改", description: "调整少量措辞或细节" },
  { value: "heavy_rewrite", label: "大幅改写", description: "保留方向，重新组织表达" },
  { value: "reference_only", label: "仅作参考", description: "只借鉴思路，不直接采用" },
];

export const FEEDBACK_REASON_OPTIONS: ReadonlyArray<{
  value: FeedbackReasonTag;
  label: string;
}> = [
  { value: "not_relevant", label: "与主题不相关" },
  { value: "too_generic", label: "内容太泛" },
  { value: "platform_mismatch", label: "平台不匹配" },
  { value: "tone_mismatch", label: "语气不匹配" },
  { value: "length_mismatch", label: "长度不合适" },
  { value: "weak_reasoning", label: "逻辑或依据不足" },
  { value: "clickbait_risk", label: "标题党风险" },
  { value: "repetitive", label: "内容重复" },
  { value: "hard_to_execute", label: "难以直接执行" },
  { value: "other", label: "其他" },
];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function fallbackId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateAnonymousCreatorId(
  storage: StorageLike,
  createId: () => string = () => fallbackId("creator"),
): string {
  const existing = storage.getItem(ANONYMOUS_CREATOR_STORAGE_KEY);
  if (existing) return existing;

  const created = createId();
  storage.setItem(ANONYMOUS_CREATOR_STORAGE_KEY, created);
  return created;
}

export function createTaskId(createId: () => string = () => fallbackId("task")): string {
  return createId();
}

export function shouldSampleFeedback(taskId: string, percentage = 20): boolean {
  let hash = 2166136261;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < percentage;
}

export function getFeedbackFormError(
  trigger: CreatorFeedbackTrigger,
  usageOutcome: FeedbackUsageOutcome | undefined,
  reasonTags: FeedbackReasonTag[],
  comment: string,
): string | null {
  if (trigger === "adoption" && !usageOutcome) return "请选择实际使用方式";
  if (reasonTags.length > 3) return "最多选择 3 个原因";
  if (!(trigger === "adoption" && usageOutcome === "direct_use") && reasonTags.length === 0) {
    return "请选择至少一个原因";
  }
  if (comment.length > 100) return "补充说明最多 100 字";
  if (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(comment) ||
    /(?:\+?86[- ]?)?1[3-9]\d{9}/.test(comment) ||
    /\b\d{17}[\dXx]\b/.test(comment)
  ) {
    return "补充说明中不能包含邮箱、手机号或身份证号";
  }
  return null;
}
