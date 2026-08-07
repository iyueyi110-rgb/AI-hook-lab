import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "./sameOrigin.ts";

test("accepts a browser origin that matches the request Host header", () => {
  const request = new Request("http://localhost:3101/api/evaluation/setup", {
    headers: { host: "127.0.0.1:3101", origin: "http://127.0.0.1:3101" },
  });

  assert.equal(isSameOriginRequest(request), true);
});

test("rejects a cross-origin host", () => {
  const request = new Request("http://localhost:3101/api/evaluation/setup", {
    headers: { host: "127.0.0.1:3101", origin: "https://attacker.example" },
  });

  assert.equal(isSameOriginRequest(request), false);
});

test("uses the forwarded protocol when checking a proxied request", () => {
  const request = new Request("http://localhost:3101/api/evaluation/setup", {
    headers: {
      host: "hook.example",
      origin: "https://hook.example",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(isSameOriginRequest(request), true);
});

test("rejects a protocol downgrade and malformed Origin", () => {
  const downgraded = new Request("https://hook.example/api/evaluation/setup", {
    headers: { host: "hook.example", origin: "http://hook.example" },
  });
  const malformed = new Request("https://hook.example/api/evaluation/setup", {
    headers: { host: "hook.example", origin: "not a url" },
  });

  assert.equal(isSameOriginRequest(downgraded), false);
  assert.equal(isSameOriginRequest(malformed), false);
});

test("preserves non-browser clients that omit Origin", () => {
  const request = new Request("https://hook.example/api/evaluation/setup", {
    headers: { host: "hook.example" },
  });

  assert.equal(isSameOriginRequest(request), true);
});
