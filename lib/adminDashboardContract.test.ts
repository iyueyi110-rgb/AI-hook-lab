import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("admin dashboard checks a database session and role at the page", async () => {
  const page = await source("app/admin/dashboard/page.tsx");
  assert.match(page, /getCurrentEvaluationUser/);
  assert.match(page, /classifyAdminAccess/);
  assert.match(page, /redirect\("\/evaluation\/login\?next=%2Fadmin%2Fdashboard"\)/);
  assert.match(page, /forbidden\(\)/);
});

test("dashboard summary API independently returns 401 and 403", async () => {
  const route = await source("app/api/dashboard/summary/route.ts");
  assert.match(route, /status:\s*401/);
  assert.match(route, /status:\s*403/);
  assert.match(route, /getCurrentEvaluationUser/);
});

test("legacy dashboard redirects and no longer renders data", async () => {
  const page = await source("app/dashboard/page.tsx");
  assert.match(page, /redirect\("\/admin\/dashboard"\)/);
  assert.doesNotMatch(page, /getDashboardSummary/);
});

test("evaluation login sanitizes next on the server and passes it to the client", async () => {
  const page = await source("app/evaluation/login/page.tsx");
  const client = await source("app/evaluation/login/EvaluationLoginClient.tsx");
  assert.match(page, /sanitizeInternalReturnPath/);
  assert.match(page, /searchParams:\s*Promise/);
  assert.match(client, /nextPath:\s*string/);
  assert.match(client, /router\.replace\(nextPath\)/);
});

test("auth handlers use tested form redirects and preserve JSON failure statuses", async () => {
  const login = await source("app/api/evaluation/auth/login/route.ts");
  const setup = await source("app/api/evaluation/setup/route.ts");
  assert.match(login, /createEvaluationFormRedirect/);
  assert.match(login, /status:\s*401/);
  assert.match(setup, /createEvaluationFormRedirect/);
  assert.match(setup, /status:\s*400/);
});
