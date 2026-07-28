import assert from "node:assert/strict";
import test from "node:test";

test("admin hub exposes four stable entries and disables governed tools by flag", async () => {
  const module = await import("./adminHub.ts").catch(() => undefined);
  assert.ok(module);

  const items = module.getAdminHubItems({
    opsAgentEnabled: false,
    strategyCardsEnabled: false,
  });

  assert.deepEqual(
    items.map((item) => item.href),
    [
      "/admin/dashboard",
      "/admin/dashboard/strategies",
      "/admin/dashboard/agent",
      "/evaluation",
    ],
  );
  assert.deepEqual(
    items.map((item) => item.enabled),
    [true, false, false, true],
  );
});
