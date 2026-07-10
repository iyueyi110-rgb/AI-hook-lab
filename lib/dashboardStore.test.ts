import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDashboardEvents, type DashboardEvent } from "./dashboardStore.ts";

test("dashboard keeps model score separate from human satisfaction and data source", () => {
  const events: DashboardEvent[] = [
    { id: "1", type: "generation_start", timestamp: "2026-07-01T00:00:00Z", dataOrigin: "evaluation" },
    { id: "2", type: "generation_complete", timestamp: "2026-07-01T00:00:01Z", dataOrigin: "evaluation", payload: { hookCount: 10, avgScore: 8.8, templateVersion: "baseline" } },
    { id: "3", type: "platform_satisfaction", timestamp: "2026-07-01T00:00:02Z", dataOrigin: "real_operation", payload: { rating: 3 } },
  ];

  const summary = summarizeDashboardEvents(events);
  assert.equal(summary.averages.avgScore, 8.8);
  assert.equal(summary.averages.avgPlatformSatisfaction, 3);
  assert.deepEqual(summary.dataOriginDistribution, { real_operation: 1, evaluation: 2, simulated: 0 });
});
