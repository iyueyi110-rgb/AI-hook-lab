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
