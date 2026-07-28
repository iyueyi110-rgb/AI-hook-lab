import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdminAccess, sanitizeInternalReturnPath } from "./adminAccess.ts";

test("admin access distinguishes missing, non-admin, and admin users", () => {
  assert.equal(classifyAdminAccess(null), "unauthenticated");
  assert.equal(classifyAdminAccess({ role: "evaluator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "adjudicator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "admin" }), "authorized");
});

test("public dashboard requires the exact true environment value", async () => {
  const accessModule = await import("./adminAccess.ts");
  const policy = Reflect.get(accessModule, "isPublicDashboardEnabled");
  assert.equal(typeof policy, "function");
  assert.equal(policy("true"), true);
  assert.equal(policy("TRUE"), false);
  assert.equal(policy("1"), false);
  assert.equal(policy(""), false);
  assert.equal(policy(undefined), false);
});

test("return paths only allow internal backend destinations", () => {
  assert.equal(sanitizeInternalReturnPath("/admin/dashboard"), "/admin/dashboard");
  assert.equal(sanitizeInternalReturnPath("/admin/dashboard/agent"), "/admin/dashboard/agent");
  assert.equal(sanitizeInternalReturnPath("/evaluation/runs/abc?tab=report"), "/evaluation/runs/abc?tab=report");
  assert.equal(sanitizeInternalReturnPath("https://evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("//evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("javascript:alert(1)"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("/not-an-internal-page"), "/evaluation");
});

test("malformed return paths fall back without throwing", () => {
  for (const value of ["/%5C[::", "/\\[::", "/evaluation/%", "/evaluation/%E0%A4%A"]) {
    assert.equal(sanitizeInternalReturnPath(value), "/evaluation");
  }
});
