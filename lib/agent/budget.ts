export const AGENT_BUDGET = Object.freeze({
  maxSteps: 4,
  maxModelCalls: 2,
  maxGenerationCalls: 1,
  // Two total model calls means one initial call plus one repair.
  formatAndCountRetries: 1,
  revisionRounds: 3,
  clarificationQuestions: 2,
  recentMessages: 20,
});

import type { Message } from "./types.ts";

export interface AgentTurnBudgetCounters {
  steps: number;
  modelCalls: number;
  generationCalls: number;
  formatAndCountRetries: number;
}

export class AgentBudgetError extends Error {
  readonly code = "agent_budget_exceeded" as const;

  constructor(counter: keyof AgentTurnBudgetCounters) {
    super(`Agent turn budget exceeded for ${counter}`);
    this.name = "AgentBudgetError";
  }
}

export function createAgentTurnBudgetCounters(): AgentTurnBudgetCounters {
  return { steps: 0, modelCalls: 0, generationCalls: 0, formatAndCountRetries: 0 };
}

function increment(
  counters: AgentTurnBudgetCounters,
  counter: keyof AgentTurnBudgetCounters,
  limit: number
): AgentTurnBudgetCounters {
  if (counters[counter] >= limit) throw new AgentBudgetError(counter);
  return { ...counters, [counter]: counters[counter] + 1 };
}

export function consumeStep(counters: AgentTurnBudgetCounters): AgentTurnBudgetCounters {
  return increment(counters, "steps", AGENT_BUDGET.maxSteps);
}

export function recordModelCall(counters: AgentTurnBudgetCounters): AgentTurnBudgetCounters {
  return increment(counters, "modelCalls", AGENT_BUDGET.maxModelCalls);
}

export function recordGenerationCall(counters: AgentTurnBudgetCounters): AgentTurnBudgetCounters {
  return increment(counters, "generationCalls", AGENT_BUDGET.maxGenerationCalls);
}

export function recordFormatAndCountRetry(counters: AgentTurnBudgetCounters): AgentTurnBudgetCounters {
  return increment(counters, "formatAndCountRetries", AGENT_BUDGET.formatAndCountRetries);
}

export function trimRecentMessages(messages: Message[]): Message[] {
  return messages.slice(-AGENT_BUDGET.recentMessages);
}
