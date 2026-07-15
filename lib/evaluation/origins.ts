import type { DataOrigin } from "./types.ts";

const ORIGIN_ALIASES: Record<string, DataOrigin> = {
  real_user: "real_user",
  evaluation_set: "evaluation_set",
  simulation: "simulation",
  real_operation: "real_user",
  evaluation: "evaluation_set",
  simulated: "simulation",
};

export function normalizeDataOrigin(value: unknown): DataOrigin {
  if (typeof value !== "string" || !ORIGIN_ALIASES[value]) {
    throw new Error(`Unsupported dataOrigin: ${String(value)}`);
  }
  return ORIGIN_ALIASES[value];
}

export function isCanonicalDataOrigin(value: unknown): value is DataOrigin {
  return value === "real_user" || value === "evaluation_set" || value === "simulation";
}

