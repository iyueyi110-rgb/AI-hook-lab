import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminNavigationItems,
  isAdminNavigationItemCurrent,
} from "./adminNavigation.ts";

test("admin navigation keeps stable order and hides governed tools when disabled", () => {
  const disabled = getAdminNavigationItems({
    opsAgentEnabled: false,
    strategyCardsEnabled: false,
  });
  assert.deepEqual(
    disabled.map((item) => item.href),
    ["/admin", "/evaluation"],
  );

  const enabled = getAdminNavigationItems({
    opsAgentEnabled: true,
    strategyCardsEnabled: true,
  });
  assert.deepEqual(
    enabled.map((item) => item.href),
    [
      "/admin",
      "/admin/dashboard/strategies",
      "/admin/dashboard/agent",
      "/evaluation",
    ],
  );
});

test("admin navigation highlights exact dashboard and nested tool routes", () => {
  assert.equal(isAdminNavigationItemCurrent("/admin", "/admin"), true);
  assert.equal(
    isAdminNavigationItemCurrent("/admin/dashboard/strategies", "/admin"),
    false,
  );
  assert.equal(
    isAdminNavigationItemCurrent(
      "/admin/dashboard/strategies",
      "/admin/dashboard/strategies",
    ),
    true,
  );
  assert.equal(
    isAdminNavigationItemCurrent("/evaluation/runs/run-1", "/evaluation"), true);
});
