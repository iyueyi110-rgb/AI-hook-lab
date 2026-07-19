import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionDatabaseConfigured,
  DatabaseNotConfiguredError,
  getConfiguredDatabaseUrl,
  getPersistenceMode,
} from "./persistence.ts";

test("development without a URL keeps JSON fallback", () => {
  assert.equal(getPersistenceMode({ NODE_ENV: "development" }), "json");
});

test("a configured URL selects postgres without exposing it", () => {
  const env = { NODE_ENV: "production" as const, DATABASE_URL: "postgresql://secret" };
  assert.equal(getPersistenceMode(env), "postgres");
  assert.equal(getConfiguredDatabaseUrl(env), "postgresql://secret");
});

test("production without a URL fails closed", () => {
  assert.equal(getPersistenceMode({ NODE_ENV: "production" }), "unavailable");
  assert.throws(
    () => assertProductionDatabaseConfigured({ VERCEL_ENV: "production" }),
    DatabaseNotConfiguredError,
  );
});
