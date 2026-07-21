import { createHmac } from "node:crypto";

export class RequestIdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestIdentityConfigError";
  }
}

export function usableSecret(value: string | undefined, production = false): string {
  const secret = value?.trim() ?? "";
  if (
    !secret
    || /^[<'"]|[>'"]$/.test(secret)
    || /^(replace_me|change_me|your_api_key|your_secret|placeholder)$/i.test(secret)
  ) {
    return "";
  }
  if (production && (
    secret.length < 32
    || new Set(secret).size < 8
    || /^(.{1,16})\1+$/.test(secret)
    || /(?:0123456789|1234567890|abcdefghijklmnopqrstuvwxyz)/i.test(secret)
  )) {
    return "";
  }
  return secret;
}

export function digestTrustedClientIp(
  request: Request,
  env: NodeJS.ProcessEnv,
  production: boolean,
): string {
  const secret = usableSecret(env.AGENT_IP_HASH_SECRET, production)
    || (production ? "" : "creative-agent-development-ip-hash");
  if (!secret) {
    throw new RequestIdentityConfigError("Anonymous IP hashing is not configured");
  }

  const headerName = env.AGENT_TRUSTED_IP_HEADER?.trim().toLowerCase()
    || (production ? "x-vercel-forwarded-for" : "x-real-ip");
  if (!/^[a-z0-9-]{1,64}$/.test(headerName)) {
    throw new RequestIdentityConfigError("Trusted IP header is invalid");
  }

  // Only a deployment-controlled header participates in the quota identity.
  // Generic X-Forwarded-For is ignored unless the deployment explicitly names
  // it and guarantees that the proxy overwrites user-supplied values.
  const address = request.headers.get(headerName)?.trim() || "unknown";
  return createHmac("sha256", secret).update(address).digest("hex");
}
