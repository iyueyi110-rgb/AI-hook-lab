import { AgentConflictError, getAllowedTools } from "./machine.ts";
import type { AgentRunStatus, ToolName, ToolResult, ToolResultStatus, ToolRisk } from "./types.ts";

export interface ToolDefinition {
  name: ToolName;
  allowedStatuses: AgentRunStatus[];
  risk: ToolRisk;
}

export const TOOL_REGISTRY: Record<ToolName, ToolDefinition> = {
  analyze_image: { name: "analyze_image", allowedStatuses: ["understanding", "analyzing_image"], risk: "medium" },
  generate_hooks: { name: "generate_hooks", allowedStatuses: ["generating"], risk: "medium" },
  rewrite_hook: { name: "rewrite_hook", allowedStatuses: ["revising"], risk: "low" },
  regenerate_batch: { name: "regenerate_batch", allowedStatuses: ["revising"], risk: "medium" },
  compare_candidates: { name: "compare_candidates", allowedStatuses: ["reviewing", "revising"], risk: "low" },
  save_final_choice: { name: "save_final_choice", allowedStatuses: ["awaiting_final_confirmation"], risk: "high" },
};

export function assertToolAllowed(status: AgentRunStatus, tool: ToolName): void {
  getAllowedTools(status, tool);
  if (!TOOL_REGISTRY[tool].allowedStatuses.includes(status)) {
    throw new AgentConflictError(`Tool ${tool} registry does not allow ${status}`);
  }
}

export function createToolResult(
  tool: ToolName,
  status: ToolResultStatus,
  output?: Record<string, unknown>,
  callId?: string,
): ToolResult {
  const base = callId ? { tool, status, callId } : { tool, status };
  if (status === "success") return { ...base, output: output ?? {} };
  if (status === "approval_required") {
    return { ...base, approval: { reason: `Approval required for ${tool}`, risk: TOOL_REGISTRY[tool].risk } };
  }
  if (status === "denied") return { ...base, error: { code: "denied", message: `Tool ${tool} was denied` } };
  return { ...base, error: { code: "tool_error", message: `Tool ${tool} failed` } };
}
