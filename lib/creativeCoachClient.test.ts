import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_RUN_STORAGE_KEY,
  buildCoachEndpoint,
  canSubmitCoachCommand,
  isCreativeCoachEnabled,
  loadCoachRunId,
  performCoachWrite,
  saveCoachRunId,
  type CoachClientResponse,
} from "./creativeCoachClient.ts";

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
