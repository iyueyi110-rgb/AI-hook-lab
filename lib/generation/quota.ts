export interface ClassicGenerationQuotaConfig {
  windowMs: number;
  ipGenerations: number;
}

export const DEFAULT_CLASSIC_GENERATION_QUOTA: ClassicGenerationQuotaConfig = Object.freeze({
  windowMs: 60 * 60 * 1000,
  ipGenerations: 20,
});

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function classicGenerationQuotaFromEnv(
  env: NodeJS.ProcessEnv,
): ClassicGenerationQuotaConfig {
  return {
    windowMs: positiveInteger(
      env.CLASSIC_QUOTA_WINDOW_SECONDS,
      DEFAULT_CLASSIC_GENERATION_QUOTA.windowMs / 1000,
    ) * 1000,
    ipGenerations: positiveInteger(
      env.CLASSIC_QUOTA_IP_GENERATIONS,
      DEFAULT_CLASSIC_GENERATION_QUOTA.ipGenerations,
    ),
  };
}
