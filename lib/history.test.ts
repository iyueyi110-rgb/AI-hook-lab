import assert from "node:assert/strict";
import test from "node:test";

import type { GenerateResponse, HistoryItem } from "./types.ts";

const historyModuleUrl = new URL("./history.ts", import.meta.url).href;

test("agent finalized history is idempotent by stable task id", async () => {
  const historyLib = await import(historyModuleUrl).catch(() => ({})) as {
    mergeHistoryItem?: (history: HistoryItem[], response: GenerateResponse) => HistoryItem[];
  };
  assert.equal(typeof historyLib.mergeHistoryItem, "function");
  const response: GenerateResponse = {
    taskId: "run-1",
    hooks: [{ id: "hook-1", text: "one", style: "style", reasoning: "reason" }],
    generatedAt: "2026-07-19T00:00:00.000Z",
    topic: "topic",
    platform: "douyin",
    contentType: "video",
  };
  const once = historyLib.mergeHistoryItem!([], response);
  const twice = historyLib.mergeHistoryItem!(once, structuredClone(response));
  const refreshed = historyLib.mergeHistoryItem!(twice, structuredClone(response));
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0]?.id, "agent-run:run-1");
});
