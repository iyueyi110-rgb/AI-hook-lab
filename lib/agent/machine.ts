import { AGENT_BUDGET } from "./budget.ts";
import type { AgentCommand, AgentRun, AgentRunStatus, ToolName } from "./types.ts";

export class AgentConflictError extends Error {
  readonly code = "agent_conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentConflictError";
  }
}

export function assertExpectedRevision(run: AgentRun, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || run.revision !== expectedRevision) {
    throw new AgentConflictError(`Expected revision ${expectedRevision}, found ${run.revision}`);
  }
}

const COMMANDS: Record<AgentRunStatus, AgentCommand["type"][]> = {
  understanding: ["message"],
  analyzing_image: ["message"],
  awaiting_brief_confirmation: ["message", "confirm_brief"],
  generating: [],
  reviewing: ["select_candidate", "rewrite_candidate", "reject_batch"],
  revising: ["select_candidate", "rewrite_candidate", "reject_batch"],
  awaiting_final_confirmation: ["message", "confirm_final"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TOOLS: Record<AgentRunStatus, ToolName[]> = {
  understanding: [],
  analyzing_image: ["analyze_image"],
  awaiting_brief_confirmation: [],
  generating: ["generate_hooks"],
  reviewing: ["compare_candidates"],
  revising: ["rewrite_hook", "regenerate_batch"],
  awaiting_final_confirmation: ["save_final_choice"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function getAllowedCommands(status: AgentRunStatus): AgentCommand["type"][] {
  return [...COMMANDS[status]];
}

export function getAllowedTools(status: AgentRunStatus, requested?: ToolName): ToolName[] {
  const tools = TOOLS[status];
  if (requested && !tools.includes(requested)) {
    throw new AgentConflictError(`Tool ${requested} is not allowed while ${status}`);
  }
  return [...tools];
}

export function transition(
  status: AgentRunStatus,
  command: AgentCommand,
  options: {
    recoverable?: boolean;
    resumeStatus?: AgentRunStatus;
    revisionRounds?: number;
  } = {}
): AgentRunStatus {
  if (status === "failed") {
    if (
      command.type !== "retry" ||
      !options.recoverable ||
      !options.resumeStatus ||
      ["failed", "completed", "cancelled"].includes(options.resumeStatus)
    ) {
      throw new AgentConflictError("Only recoverable failed runs with a resume status can retry");
    }
    return options.resumeStatus;
  }

  if (!COMMANDS[status].includes(command.type)) {
    throw new AgentConflictError(`Command ${command.type} is not allowed while ${status}`);
  }

  if (command.type === "rewrite_candidate" || command.type === "reject_batch") {
    const rounds = options.revisionRounds ?? 0;
    if (!Number.isInteger(rounds) || rounds < 0 || rounds >= AGENT_BUDGET.revisionRounds) {
      throw new AgentConflictError("Revision round limit reached");
    }
    return "revising";
  }

  if (command.type === "confirm_brief") return "generating";
  if (command.type === "select_candidate") return "awaiting_final_confirmation";
  if (command.type === "confirm_final") return "completed";
  return status;
}

export function applyCommand(run: AgentRun, expectedRevision: number, command: AgentCommand): AgentRun {
  assertExpectedRevision(run, expectedRevision);
  const status = transition(run.status, command, {
    recoverable: run.recoverable,
    resumeStatus: run.resumeStatus,
    revisionRounds: run.revisionRounds,
  });
  const revisionRounds = command.type === "rewrite_candidate" || command.type === "reject_batch"
    ? run.revisionRounds + 1
    : run.revisionRounds;
  return { ...run, status, revisionRounds, revision: run.revision + 1 };
}
