import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";

const postgresTransactionStorage = new AsyncLocalStorage<PoolClient>();

export function activePostgresTransactionClient(): PoolClient | undefined {
  return postgresTransactionStorage.getStore();
}

export async function withPostgresTransactionClient<T>(
  client: PoolClient,
  operation: () => T | Promise<T>,
): Promise<T> {
  return postgresTransactionStorage.run(client, async () => operation());
}
