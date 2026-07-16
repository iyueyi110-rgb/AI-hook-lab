import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdminAccess, sanitizeInternalReturnPath } from "./adminAccess.ts";

test("admin access distinguishes missing, non-admin, and admin users", () => {
  assert.equal(classifyAdminAccess(null), "unauthenticated");
  assert.equal(classifyAdminAccess({ role: "evaluator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "adjudicator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "admin" }), "authorized");
});

test("return paths only allow internal backend destinations", () => {
  assert.equal(sanitizeInternalReturnPath("/admin/dashboard"), "/admin/dashboard");
  assert.equal(sanitizeInternalReturnPath("/evaluation/runs/abc?tab=report"), "/evaluation/runs/abc?tab=report");
  assert.equal(sanitizeInternalReturnPath("https://evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("//evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("javascript:alert(1)"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("/not-an-internal-page"), "/evaluation");
});
