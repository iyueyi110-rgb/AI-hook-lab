import type {
  DataOrigin,
  EvaluationReport,
  ExecutionMode,
  GateResult,
  RunStatus,
  UpgradeRecommendation,
  UserRole,
} from "./types";
import type {
  StrategyEvaluationReport,
  StrategyEvaluationSnapshot,
} from "../strategy/types";

export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  real_user: "用户操作事件",
  evaluation_set: "离线评测数据",
  simulation: "模拟事件",
};

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  live: "Live 模型评测",
  mock: "Mock 流程演示",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: "待开始",
  generating: "生成中",
  generated: "待筛选",
  selecting: "筛选中",
  reviewing: "评分中",
  adjudicating: "待裁决",
  completed: "已完成",
  failed: "已失败",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  evaluator: "评测员",
  adjudicator: "裁决员",
};

export const UPGRADE_RECOMMENDATION_LABELS: Record<UpgradeRecommendation, string> = {
  recommend_upgrade: "建议升级",
  do_not_upgrade: "暂不升级",
  needs_more_evaluation: "需要继续评测",
};

export const EVALUATION_GATE_LABELS: Record<keyof EvaluationReport["gates"], string> = {
  usabilityImprovement: "人工可用性提升",
  platformFitImprovement: "平台适配度提升",
  pairwiseWinRate: "A/B 盲评胜率",
  highSeverityRegression: "高严重度问题不增加",
  platformUsabilityRegression: "单平台可用性无明显回退",
  formatErrorRegression: "首次格式错误率不增加",
  lengthRegression: "字数超限不增加",
};

const STRATEGY_RECOMMENDATION_LABELS: Record<StrategyEvaluationReport["recommendation"], string> = {
  recommend_activate: "建议启用",
  do_not_activate: "暂不启用",
  needs_more_evaluation: "需要继续评测",
};

const STRATEGY_GATE_LABELS: Record<keyof StrategyEvaluationReport["gates"], string> = {
  usabilityImprovement: "人工可用性提升",
  platformFitImprovement: "平台适配度提升",
  pairwiseWinRate: "A/B 盲评胜率",
  highSeverityRegression: "高严重度问题不增加",
  adoptionIntentRegression: "人工采用意向不回退",
  formatErrorRegression: "首次格式错误率不增加",
  lengthRegression: "字数超限不增加",
};

export interface StrategyReportPayload {
  evaluationKind: "strategy";
  snapshot: StrategyEvaluationSnapshot;
  gateReport: StrategyEvaluationReport;
}

export type ReadableEvaluationReport = EvaluationReport | StrategyReportPayload;

export interface ReadableGate {
  key: string;
  label: string;
  passed: boolean;
  actual?: number | null;
  threshold?: string;
}

export interface EvaluationReportSummary {
  recommendationLabel: string;
  reason: string;
  conclusive: boolean;
  passedGateCount: number;
  totalGateCount: number;
  metrics: Array<{ label: string; value: string }>;
  gates: ReadableGate[];
}

export function formatDataOrigin(origin: string): string {
  return DATA_ORIGIN_LABELS[origin as DataOrigin] ?? "未知数据来源";
}

export function formatExecutionMode(mode: string): string {
  return EXECUTION_MODE_LABELS[mode as ExecutionMode] ?? "未知执行模式";
}

export function formatRunStatus(status: string): string {
  return RUN_STATUS_LABELS[status as RunStatus] ?? "未知状态";
}

export function formatUserRole(role: string): string {
  return USER_ROLE_LABELS[role as UserRole] ?? "未知身份";
}

export function formatAccountStatus(status: string): string {
  return status === "active" ? "使用中" : status === "disabled" ? "已停用" : "未知状态";
}

export function formatPromptRole(role: string): string {
  return role === "baseline" ? "基准版本" : role === "candidate" ? "候选版本" : role;
}

export function formatGenerationTaskStatus(status: string): string {
  return {
    pending: "等待生成",
    success: "生成成功",
    format_error: "结果格式异常",
    generation_error: "生成失败",
  }[status] ?? "未知状态";
}

export function formatGenerationErrorCategory(category: unknown): string {
  if (typeof category !== "string") return "生成失败";
  const labels: Record<string, string> = {
    "API Key 未配置": "生成服务配置异常",
    "API Key 无效": "生成服务配置异常",
    "AI 服务异常": "生成服务异常",
    "AI 返回为空": "生成结果格式异常",
    "JSON 解析失败": "生成结果格式异常",
    "请求格式错误": "提交内容格式异常",
    "请求太频繁": "请求过于频繁",
    "主题为空": "主题为空",
    "主题过长": "主题过长",
    "目标用户描述过长": "目标用户描述过长",
    "输入包含疑似个人信息": "输入包含疑似个人信息",
    "平台不支持": "平台不支持",
    "内容类型不支持": "内容类型不支持",
    "请求超时": "请求超时",
    "生成失败": "生成失败",
    "网络错误": "网络错误",
  };
  return labels[category] ?? "生成失败";
}

function isStrategyReport(report: ReadableEvaluationReport): report is StrategyReportPayload {
  return "evaluationKind" in report && report.evaluationKind === "strategy";
}

function formatPercent(value: number | null): string {
  return value === null ? "待完成" : `${value}%`;
}

function readableGate(key: keyof EvaluationReport["gates"], result: GateResult): ReadableGate {
  return {
    key,
    label: EVALUATION_GATE_LABELS[key],
    passed: result.passed,
    actual: result.actual,
    threshold: result.threshold,
  };
}

export function summarizeEvaluationReport(report: ReadableEvaluationReport): EvaluationReportSummary {
  if (isStrategyReport(report)) {
    const gates = Object.entries(report.gateReport.gates).map(([key, passed]) => ({
      key,
      label: STRATEGY_GATE_LABELS[key as keyof StrategyEvaluationReport["gates"]],
      passed,
    }));
    const { metrics } = report.snapshot;
    const candidateSampleSize = report.snapshot.candidateScoredResults;
    const reason = report.snapshot.executionMode === "mock"
      ? "Mock 数据仅用于流程演示，不能形成策略启用结论。"
      : !report.gateReport.complete
        ? "评测尚未完成，或未覆盖固定主题与全部人工判断。"
        : report.gateReport.recommendation === "recommend_activate"
          ? "候选策略通过全部启用门槛。"
          : "候选策略未通过全部启用门槛。";
    return {
      recommendationLabel: STRATEGY_RECOMMENDATION_LABELS[report.gateReport.recommendation],
      reason,
      conclusive: report.gateReport.recommendation !== "needs_more_evaluation",
      passedGateCount: gates.filter((gate) => gate.passed).length,
      totalGateCount: gates.length,
      metrics: [
        { label: "候选人工可用率", value: candidateSampleSize ? `${metrics.candidateUsabilityRate}%（${candidateSampleSize}/${report.snapshot.caseCount}）` : "待完成" },
        { label: "候选平台适配率", value: candidateSampleSize ? `${metrics.candidatePlatformFitRate}%（${candidateSampleSize}/${report.snapshot.caseCount}）` : "待完成" },
        { label: "候选 A/B 胜率", value: formatPercent(metrics.candidateWinRate) },
      ],
      gates,
    };
  }

  const gates = Object.entries(report.gates).map(([key, result]) =>
    readableGate(key as keyof EvaluationReport["gates"], result),
  );
  const candidateSampleSize = report.versions.candidate.scoredResults;
  return {
    recommendationLabel: UPGRADE_RECOMMENDATION_LABELS[report.recommendation],
    reason: `${report.recommendationReason}。`,
    conclusive: report.recommendation !== "needs_more_evaluation",
    passedGateCount: gates.filter((gate) => gate.passed).length,
    totalGateCount: gates.length,
    metrics: [
      { label: "候选人工可用率", value: candidateSampleSize ? `${report.versions.candidate.usabilityRate}%（${candidateSampleSize}/60）` : "待完成" },
      { label: "候选平台适配率", value: candidateSampleSize ? `${report.versions.candidate.platformFitRate}%（${candidateSampleSize}/60）` : "待完成" },
      { label: "候选 A/B 胜率", value: formatPercent(report.pairwise.candidateWinRate) },
    ],
    gates,
  };
}
