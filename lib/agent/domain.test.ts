import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_STYLES } from "../constants.ts";
import {
  AGENT_BUDGET,
  AgentConflictError,
  MEMORY_WORD_LIMIT_BANDS,
  TOOL_REGISTRY,
  compareCandidates,
  createToolResult,
  getAllowedCommands,
  getAllowedTools,
  normalizeBrief,
  recordMemory,
  resolveMemoryPreference,
  transition,
  type Candidate,
  type Memory,
} from "./index.ts";

const baseCandidate = (id: string, overallScore: number, badcaseTags: string[] = []): Candidate => ({
  id,
  text: `hook ${id}`,
  style: "style-a",
  reasoning: `reasoning for ${id}`,
  overallScore,
  scores: { impact: overallScore, platformFit: overallScore, actionability: overallScore, shareability: overallScore },
  badcaseTags,
});

test("exposes the fixed per-turn budgets", () => {
  assert.deepEqual(AGENT_BUDGET, {
    maxSteps: 4,
    maxModelCalls: 2,
    maxGenerationCalls: 1,
    formatAndCountRetries: 2,
    revisionRounds: 3,
    clarificationQuestions: 2,
    recentMessages: 20,
  });
});

test("allows only the approved command transition matrix", () => {
  const matrix = {
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
  } as const;

  for (const [status, expected] of Object.entries(matrix)) {
    assert.deepEqual(getAllowedCommands(status as keyof typeof matrix), expected);
  }

  assert.equal(transition("awaiting_brief_confirmation", { type: "confirm_brief" }), "generating");
  assert.equal(transition("reviewing", { type: "select_candidate", candidateId: "a" }), "awaiting_final_confirmation");
  assert.equal(transition("awaiting_final_confirmation", { type: "confirm_final" }), "completed");
  assert.throws(() => transition("generating", { type: "message", text: "no" }), AgentConflictError);
  assert.throws(() => transition("completed", { type: "confirm_final" }), AgentConflictError);
  assert.equal(transition("failed", { type: "retry" }, { recoverable: true, resumeStatus: "generating" }), "generating");
  assert.throws(() => transition("failed", { type: "retry" }, { recoverable: false, resumeStatus: "generating" }), AgentConflictError);
  assert.throws(() => transition("failed", { type: "retry" }, { recoverable: true, resumeStatus: "completed" }), AgentConflictError);
});

test("blocks every tool outside its exact approved state", () => {
  for (const tool of Object.values(TOOL_REGISTRY)) {
    for (const status of [
      "understanding", "analyzing_image", "awaiting_brief_confirmation", "generating", "reviewing",
      "revising", "awaiting_final_confirmation", "completed", "failed", "cancelled",
    ] as const) {
      if (tool.allowedStatuses.includes(status)) {
        assert.ok(getAllowedTools(status).includes(tool.name));
      } else {
        assert.throws(() => getAllowedTools(status, tool.name), AgentConflictError);
      }
    }
  }
});

test("enforces revision conflicts and the three-round limit", () => {
  assert.throws(() => transition("reviewing", { type: "rewrite_candidate", candidateId: "a" }, { revisionRounds: 3 }), AgentConflictError);
  assert.equal(transition("reviewing", { type: "rewrite_candidate", candidateId: "a" }, { revisionRounds: 2 }), "revising");
  assert.throws(() => transition("revising", { type: "rewrite_candidate", candidateId: "a" }, { revisionRounds: -1 }), AgentConflictError);
});

test("creates all structured tool result outcomes", () => {
  for (const status of ["success", "error", "denied", "approval_required"] as const) {
    const result = createToolResult("generate_hooks", status, status === "success" ? { count: 3 } : undefined);
    assert.equal(result.tool, "generate_hooks");
    assert.equal(result.status, status);
  }
});

test("ranks a stable Top 3 from model-provided scores and known bad-case tags only", () => {
  const result = compareCandidates([
    baseCandidate("z", 9, ["too_long"]),
    baseCandidate("b", 9),
    { ...baseCandidate("a", 9), scores: { impact: 9, platformFit: 9, actionability: 9, shareability: 8 } },
    baseCandidate("c", 8),
  ]);

  assert.deepEqual(result.top3.map((candidate) => candidate.id), ["b", "z", "a"]);
  assert.match(result.explanations[0] ?? "", /scores|reasoning|bad-case/i);
  assert.doesNotMatch(result.explanations.join(" "), /click|CTR|performance|表现/i);
});

test("stores only whitelist memory, resolves conflicts, and lets current briefs override it", () => {
  let memory: Memory = { entries: [] };
  ({ memory } = recordMemory(memory, { key: "default_platform", value: "douyin" }));
  ({ memory } = recordMemory(memory, { key: "preferred_tone", value: "curious" }));
  ({ memory } = recordMemory(memory, { key: "preferred_tone", value: "curious" }));
  assert.equal(memory.entries.find((entry) => entry.key === "preferred_tone")?.confidence, 0.7);
  for (let index = 0; index < 3; index += 1) ({ memory } = recordMemory(memory, { key: "preferred_tone", value: "curious" }));
  assert.equal(memory.entries.find((entry) => entry.key === "preferred_tone")?.confidence, 0.9);
  assert.equal(resolveMemoryPreference(memory, "default_platform", { platform: "x" }), "x");
  assert.equal(resolveMemoryPreference(memory, "preferred_tone", { emotionTone: "urgent" }), "urgent");
  assert.equal(recordMemory(memory, { key: "preferred_style", value: "not-a-platform-style" }).accepted, false);
  assert.equal(recordMemory(memory, { key: "default_platform", value: "person@example.com" }).accepted, false);
  const style = PLATFORM_STYLES.douyin[0]!;
  ({ memory } = recordMemory(memory, { key: "preferred_style", value: style }));
  assert.equal(recordMemory(memory, { key: "avoided_style", value: style }).accepted, false);
  assert.ok(MEMORY_WORD_LIMIT_BANDS.length === 4);
});

test("normalizes defaults and stops after two clarification questions", () => {
  const ready = normalizeBrief({ topic: "topic", platform: "douyin", contentType: "video" });
  assert.equal(ready.kind, "complete");
  if (ready.kind === "complete") assert.equal(ready.brief.wordLimitBand, MEMORY_WORD_LIMIT_BANDS[1]);
  assert.deepEqual(normalizeBrief({ topic: "topic" }, 1), { kind: "needs_clarification", missing: ["platform", "contentType"] });
  assert.deepEqual(normalizeBrief({ topic: "topic" }, 2), { kind: "requires_form_completion", missing: ["platform", "contentType"] });
});
