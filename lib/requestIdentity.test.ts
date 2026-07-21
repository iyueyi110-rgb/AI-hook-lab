import assert from "node:assert/strict";
import test from "node:test";

import {
  digestTrustedClientIp,
  RequestIdentityConfigError,
} from "./requestIdentity.ts";

test("trusted client identity hashes only the configured proxy header", () => {
  const env = {
    NODE_ENV: "production",
    AGENT_IP_HASH_SECRET: "7f2a9c4e1b6d8f3a5c0e7b2d9a4f6c1e",
    AGENT_TRUSTED_IP_HEADER: "x-real-ip",
  } as NodeJS.ProcessEnv;
  const first = digestTrustedClientIp(new Request("https://example.test", {
    headers: { "x-real-ip": "203.0.113.4", "x-forwarded-for": "attacker" },
  }), env, true);
  const second = digestTrustedClientIp(new Request("https://example.test", {
    headers: { "x-real-ip": "203.0.113.4", "x-forwarded-for": "different" },
  }), env, true);

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.doesNotMatch(first, /203\.0\.113\.4/);
});

test("production identity rejects placeholders, weak secrets and invalid headers", () => {
  const request = new Request("https://example.test");
  assert.throws(
    () => digestTrustedClientIp(request, { AGENT_IP_HASH_SECRET: "replace_me" } as NodeJS.ProcessEnv, true),
    RequestIdentityConfigError,
  );
  assert.throws(
    () => digestTrustedClientIp(request, { AGENT_IP_HASH_SECRET: "a".repeat(32) } as NodeJS.ProcessEnv, true),
    RequestIdentityConfigError,
  );
  assert.throws(
    () => digestTrustedClientIp(request, {
      AGENT_IP_HASH_SECRET: "7f2a9c4e1b6d8f3a5c0e7b2d9a4f6c1e",
      AGENT_TRUSTED_IP_HEADER: "bad header",
    } as NodeJS.ProcessEnv, true),
    RequestIdentityConfigError,
  );
});
