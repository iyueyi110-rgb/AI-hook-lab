import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_RUN_STORAGE_KEY,
  buildCoachEndpoint,
  buildCoachBriefInput,
  canEditCoachBrief,
  canSubmitCoachCommand,
  isCreativeCoachEnabled,
  loadCoachRunId,
  performCoachWrite,
  saveCoachRunId,
  type CoachClientResponse,
} from "./creativeCoachClient.ts";
import * as coachClient from "./creativeCoachClient.ts";

function response(allowedCommands: CoachClientResponse["allowedCommands"]): CoachClientResponse {
  return {
    run: {
      id: "run-1",
      revision: 3,
      status: "reviewing",
      messages: [],
      candidates: [],
      toolCalls: [],
      toolResults: [],
      approvals: [],
      memory: { entries: [] },
      revisionRounds: 0,
    },
    messages: [],
    candidates: [],
    topCandidates: [],
    comparisonExplanations: [],
    pendingConfirmation: null,
    allowedCommands,
    needsInput: true,
  };
}

test("creative coach feature flag is enabled only by the exact public true value", () => {
  assert.equal(isCreativeCoachEnabled("true"), true);
  assert.equal(isCreativeCoachEnabled("TRUE"), false);
  assert.equal(isCreativeCoachEnabled("1"), false);
  assert.equal(isCreativeCoachEnabled(undefined), false);
});

test("coach run pointer stores only the run id and rejects malformed saved data", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  saveCoachRunId(storage, "run-123");
  assert.equal(values.get(COACH_RUN_STORAGE_KEY), "run-123");
  assert.equal(loadCoachRunId(storage), "run-123");
  values.set(COACH_RUN_STORAGE_KEY, JSON.stringify({ runId: "run-1", topic: "private" }));
  assert.equal(loadCoachRunId(storage), null);
  assert.equal(values.has(COACH_RUN_STORAGE_KEY), false);
});

test("coach commands are gated by the server allowedCommands contract", () => {
  const current = response(["rewrite_candidate", "select_candidate"]);
  assert.equal(canSubmitCoachCommand(current, "rewrite_candidate"), true);
  assert.equal(canSubmitCoachCommand(current, "confirm_final"), false);
  assert.equal(canSubmitCoachCommand(null, "retry"), false);
});

test("coach endpoints keep image analysis on the agent route", () => {
  assert.equal(buildCoachEndpoint("run", "run 1"), "/api/agent/runs/run%201");
  assert.equal(buildCoachEndpoint("turn", "run 1"), "/api/agent/runs/run%201/turns");
  assert.equal(buildCoachEndpoint("image", "run 1"), "/api/agent/runs/run%201/image");
  assert.equal(buildCoachEndpoint("memory"), "/api/agent/memory");
  assert.equal(buildCoachEndpoint("memoryEntry", "memory/1"), "/api/agent/memory/memory%2F1");
});

test("a stale write refreshes once and is never replayed", async () => {
  let writes = 0;
  let refreshes = 0;
  await assert.rejects(
    () => performCoachWrite(
      async () => {
        writes += 1;
        return Response.json({ error: "agent_conflict", message: "stale revision" }, { status: 409 });
      },
      async () => { refreshes += 1; },
    ),
    (error: unknown) => error instanceof Error && error.name === "CoachClientError",
  );
  assert.equal(writes, 1);
  assert.equal(refreshes, 1);
});

test("a synchronous coach write gate coalesces identical writes and rejects a different action", async () => {
  const createGate = (coachClient as unknown as { createCoachWriteGate?: () => { run<T>(key: string, operation: () => Promise<T>): Promise<T> } }).createCoachWriteGate;
  assert.equal(typeof createGate, "function");
  const gate = createGate!();
  let writes = 0;
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => { release = resolve; });
  const first = gate.run("run:confirm", async () => { writes += 1; return pending; });
  const second = gate.run("run:confirm", async () => { writes += 1; return "duplicate"; });
  assert.equal(first, second);
  assert.equal(writes, 1);
  await assert.rejects(gate.run("run:cancel", async () => "cancelled"), /already in progress/);
  release("saved");
  assert.equal(await second, "saved");
});

test("tool analytics correlate results by callId and emit failures once", () => {
  const collect = (coachClient as unknown as {
    collectCoachToolEvents?: (response: CoachClientResponse, seen: Set<string>) => Array<{ callId: string; status: string; tool: string }>;
  }).collectCoachToolEvents;
  assert.equal(typeof collect, "function");
  const current = response([]);
  current.run.toolCalls = [
    { id: "success-call", tool: "generate_hooks", input: {}, status: "completed", createdAt: "2026-01-01" },
    { id: "error-call", tool: "analyze_image", input: {}, status: "completed", createdAt: "2026-01-01" },
    { id: "denied-call", tool: "save_final_choice", input: {}, status: "completed", createdAt: "2026-01-01" },
  ];
  current.run.toolResults = [
    { callId: "error-call", tool: "analyze_image", status: "error" },
    { callId: "success-call", tool: "generate_hooks", status: "success" },
    { callId: "denied-call", tool: "save_final_choice", status: "denied" },
  ];
  const seen = new Set<string>();
  assert.deepEqual(collect!(current, seen).map(({ callId, status }) => ({ callId, status })), [
    { callId: "success-call", status: "completed" },
    { callId: "error-call", status: "error" },
    { callId: "denied-call", status: "denied" },
  ]);
  assert.deepEqual(collect!(current, seen), []);
});

test("untouched coach defaults defer to remembered values and structured fallback stays editable", () => {
  const form = { topic: " topic ", platform: "xiaohongshu" as const, contentType: "video" as const, targetAudience: "", emotionTone: "curious" as const, wordLimitBand: "60-80" as const };
  const deferred = buildCoachBriefInput(form, {
    ignoreMemory: false, platformTouched: false, emotionToneTouched: false, wordLimitTouched: false,
    rememberedPlatform: "douyin", rememberedTone: "urgent", rememberedWordBand: "30-50",
  });
  assert.deepEqual(deferred, { topic: "topic", contentType: "video" });
  const explicit = buildCoachBriefInput(form, {
    ignoreMemory: true, platformTouched: false, emotionToneTouched: false, wordLimitTouched: false,
    rememberedPlatform: "douyin", rememberedTone: "urgent", rememberedWordBand: "30-50",
  });
  assert.equal(explicit.platform, "xiaohongshu");
  assert.equal(explicit.emotionTone, "curious");
  assert.equal(explicit.wordLimitBand, "60-80");

  const run = response(["message"]).run;
  run.status = "understanding";
  run.requiresFormCompletion = true;
  assert.equal(canEditCoachBrief(run, ["message"], true), true);
  run.requiresFormCompletion = false;
  assert.equal(canEditCoachBrief(run, ["message"], true), false);
});
