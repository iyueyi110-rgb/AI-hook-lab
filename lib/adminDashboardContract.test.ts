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
  assert.match(route, /searchParams\.get\("from"\)/);
  assert.match(route, /searchParams\.get\("to"\)/);
  assert.match(route, /from 和 to 必须同时提供/);
  assert.match(route, /from 必须早于 to/);
  assert.match(route, /getDashboardSummary\(requested, \{ platform, promptVersion, trigger, from, to \}\)/);
});

test("dashboard APIs return 503 when production persistence is unavailable", async () => {
  const eventsRoute = await source("app/api/dashboard/events/route.ts");
  const summaryRoute = await source("app/api/dashboard/summary/route.ts");
  for (const route of [eventsRoute, summaryRoute]) {
    assert.match(route, /isDatabaseNotConfiguredError/);
    assert.match(route, /status:\s*503/);
    assert.match(route, /数据库未配置/);
  }
});

test("internal pages explain unavailable production persistence before session access", async () => {
  const loginPage = await source("app/evaluation/login/page.tsx");
  const dashboardPage = await source("app/admin/dashboard/page.tsx");
  for (const page of [loginPage, dashboardPage]) {
    assert.match(page, /DatabaseUnavailablePanel/);
    assert.match(page, /getPersistenceMode\(\) === "unavailable"/);
    assert.ok(page.indexOf("getPersistenceMode()") < page.indexOf("getCurrentEvaluationUser()"));
  }
});

test("both persistence stores use the shared environment policy", async () => {
  const dashboardStore = await source("lib/dashboardStore.ts");
  const evaluationRepository = await source("lib/evaluation/repository.ts");
  assert.match(dashboardStore, /assertProductionDatabaseConfigured/);
  assert.match(dashboardStore, /getConfiguredDatabaseUrl/);
  assert.match(evaluationRepository, /getPersistenceMode/);
  assert.match(evaluationRepository, /DatabaseNotConfiguredError/);
});

test("generation start analytics omit the raw topic", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, /generation_start[^\n]+topic/);
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
