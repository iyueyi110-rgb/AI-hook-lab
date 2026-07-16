import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationFormRedirect } from "./formRedirect.ts";

const origin = "https://hookovo.test";

test("form success returns 303 to the sanitized internal next path", () => {
  const response = createEvaluationFormRedirect(
    `${origin}/api/evaluation/auth/login?next=%2Fadmin%2Fdashboard%3Ftab%3Dlatest`,
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/admin/dashboard?tab=latest`);
});

test("form failure returns 303 to login with the error and safe fallback next", () => {
  const response = createEvaluationFormRedirect(
    `${origin}/api/evaluation/auth/login?next=https%3A%2F%2Fevil.example%2Fsteal`,
    "login_failed",
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `${origin}/evaluation/login?error=login_failed&next=%2Fevaluation`,
  );
});

test("unsafe and malformed next values never throw or produce an external location", () => {
  for (const next of [
    "https%3A%2F%2Fevil.example%2Fsteal",
    "%2F%2Fevil.example%2Fsteal",
    "/%5C[::",
    "%2Fevaluation%2F%25",
  ]) {
    let response: Response | undefined;
    assert.doesNotThrow(() => {
      response = createEvaluationFormRedirect(
        `${origin}/api/evaluation/setup?next=${next}`,
        "setup_failed",
      );
    });
    assert.equal(response?.status, 303);
    const location = new URL(response?.headers.get("location") ?? "");
    assert.equal(location.origin, origin);
    assert.equal(location.pathname, "/evaluation/login");
    assert.equal(location.searchParams.get("error"), "setup_failed");
    assert.equal(location.searchParams.get("next"), "/evaluation");
  }
});
