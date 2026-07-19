export type PersistenceMode = "postgres" | "json" | "unavailable";

type PersistenceEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "DATABASE_URL" | "NODE_ENV" | "VERCEL_ENV">
>;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("生产环境数据库未配置，请连接 Neon PostgreSQL 后重试");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getConfiguredDatabaseUrl(
  env: PersistenceEnvironment = process.env,
): string | undefined {
  return env.DATABASE_URL?.trim() || undefined;
}

export function getPersistenceMode(
  env: PersistenceEnvironment = process.env,
): PersistenceMode {
  if (getConfiguredDatabaseUrl(env)) return "postgres";
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return "unavailable";
  }
  return "json";
}

export function assertProductionDatabaseConfigured(
  env: PersistenceEnvironment = process.env,
): void {
  if (getPersistenceMode(env) === "unavailable") {
    throw new DatabaseNotConfiguredError();
  }
}

export function isDatabaseNotConfiguredError(
  error: unknown,
): error is DatabaseNotConfiguredError {
  return error instanceof DatabaseNotConfiguredError;
}
