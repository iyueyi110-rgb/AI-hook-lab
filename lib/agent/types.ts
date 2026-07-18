import type { ContentType, EmotionTone, HookScores, Platform } from "../types.ts";

export type AgentRunStatus =
  | "understanding"
  | "analyzing_image"
  | "awaiting_brief_confirmation"
  | "generating"
  | "reviewing"
  | "revising"
  | "awaiting_final_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentCommand =
  | { type: "message"; text: string }
  | { type: "confirm_brief" }
  | { type: "select_candidate"; candidateId: string }
  | { type: "rewrite_candidate"; candidateId: string; instruction?: string }
  | { type: "reject_batch"; reason?: string }
  | { type: "confirm_final" }
  | { type: "retry" };

export type WordLimitBand = "30-50" | "60-80" | "90-110" | "120-150";

export interface CreativeBrief {
  topic: string;
  platform: Platform;
  contentType: ContentType;
  targetAudience: string;
  emotionTone: EmotionTone;
  wordLimitBand: WordLimitBand;
  preferredStyle?: string;
  avoidBadcaseTags: string[];
  imageDescription?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface Candidate {
  id: string;
  text: string;
  style: string;
  reasoning: string;
  overallScore: number;
  scores: HookScores;
  badcaseTags: string[];
}

export type ToolName =
  | "analyze_image"
  | "generate_hooks"
  | "rewrite_hook"
  | "regenerate_batch"
  | "compare_candidates"
  | "save_final_choice";

export type ToolRisk = "low" | "medium" | "high";

export interface ToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
  status: "requested" | "running" | "completed";
  createdAt: string;
}

export type ToolResultStatus = "success" | "error" | "denied" | "approval_required";

export interface ToolResult {
  tool: ToolName;
  status: ToolResultStatus;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
  approval?: { reason: string; risk: ToolRisk };
}

export interface Approval {
  id: string;
  tool: ToolName;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  resolvedAt?: string;
}

export type MemoryKey =
  | "default_platform"
  | "preferred_style"
  | "avoided_style"
  | "preferred_tone"
  | "word_limit_band"
  | "avoid_badcase_tag";

export interface MemoryEntry {
  key: MemoryKey;
  value: string;
  confidence: number;
}

export interface Memory {
  entries: MemoryEntry[];
}

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  brief?: CreativeBrief;
  messages: Message[];
  candidates: Candidate[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  approvals: Approval[];
  memory: Memory;
  revisionRounds: number;
  recoverable?: boolean;
  resumeStatus?: Exclude<AgentRunStatus, "failed" | "completed" | "cancelled">;
}
