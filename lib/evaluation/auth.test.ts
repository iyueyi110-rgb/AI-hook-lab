import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword, createSessionToken } from "./auth.ts";

test("password hashes use a unique salt and verify without storing plaintext", async () => {
  const first = await hashPassword("a-strong-password");
  const second = await hashPassword("a-strong-password");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword("a-strong-password", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
});

test("session token exposes a random secret while persisting only its digest", () => {
  const session = createSessionToken();
  assert.notEqual(session.token, session.tokenHash);
  assert.equal(session.token.length >= 40, true);
  assert.equal(session.tokenHash.length, 64);
});
