import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import {
  activePostgresTransactionClient,
  withPostgresTransactionClient,
} from "./postgresTransactionContext.ts";

test("PostgreSQL transaction context is async-scoped and never leaks after completion", async () => {
  const client = { query: async () => ({ rows: [] }) } as unknown as PoolClient;
  assert.equal(activePostgresTransactionClient(), undefined);
  await withPostgresTransactionClient(client, async () => {
    assert.equal(activePostgresTransactionClient(), client);
    await Promise.resolve();
    assert.equal(activePostgresTransactionClient(), client);
  });
  assert.equal(activePostgresTransactionClient(), undefined);
});
