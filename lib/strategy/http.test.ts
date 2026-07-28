import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStrategyHttpHandlers } from "./http.ts";
import { JsonStrategyRepository } from "./repository.ts";
import { StrategyService } from "./service.ts";

const admin = {
  id: "admin-1",
  username: "admin",
  displayName: "管理员",
  passwordHash: "hash",
  passwordSalt: "salt",
  role: "admin" as const,
  status: "active" as const,
  failedLoginCount: 0,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const draft = {
  title: "抖音教程策略",
  scopePairs: [{ platform: "douyin", contentType: "tutorial" }],
  guidance: { do: ["用具体结果开头"], avoid: [] },
  hypothesis: "提升平台适配。",
};

async function setup(currentUser: () => Promise<typeof admin | null> = async () => admin) {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), "strategy-http-")), "state.json");
  const service = new StrategyService(new JsonStrategyRepository(file), () => new Date("2026-07-28T00:00:00.000Z"));
  const handlers = createStrategyHttpHandlers({ service, currentUser, enabled: true });
  return { service, handlers };
}

test("strategy admin writes require admin authentication and same origin", async () => {
  const unauthenticated = await setup(async () => null);
  const denied = await unauthenticated.handlers.createDraft(new Request("https://app.test/api/admin/strategies", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify(draft),
  }));
  assert.equal(denied.status, 401);

  const { handlers } = await setup();
  const crossOrigin = await handlers.createDraft(new Request("https://app.test/api/admin/strategies", {
    method: "POST",
    headers: { origin: "https://evil.test", "content-type": "application/json" },
    body: JSON.stringify(draft),
  }));
  assert.equal(crossOrigin.status, 403);
});

test("strategy admin APIs reject unknown fields and stale revisions", async () => {
  const { handlers } = await setup();
  const malformed = await handlers.createDraft(new Request("https://app.test/api/admin/strategies", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify({ ...draft, unexpected: true }),
  }));
  assert.equal(malformed.status, 400);

  const createdResponse = await handlers.createDraft(new Request("https://app.test/api/admin/strategies", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify(draft),
  }));
  const created = await createdResponse.json() as { card: { id: string }; version: { version: number } };
  const stale = await handlers.patchVersion(
    new Request("https://app.test/api/admin/strategies/x/versions/1", {
      method: "PATCH",
      headers: { origin: "https://app.test", "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4, content: draft }),
    }),
    created.card.id,
    created.version.version,
  );
  assert.equal(stale.status, 409);
});

test("public active strategy query is sanitized, bounded and feature gated", async () => {
  const disabled = createStrategyHttpHandlers({ enabled: false, currentUser: async () => admin });
  const hidden = await disabled.listActive(new Request("https://app.test/api/strategies/active?platform=douyin&contentType=tutorial"));
  assert.equal(hidden.status, 404);

  const { handlers } = await setup();
  const invalid = await handlers.listActive(new Request("https://app.test/api/strategies/active?platform=unknown&contentType=tutorial"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
});

test("strategy action errors expose stable codes without governed content", async () => {
  const { handlers } = await setup();
  const createdResponse = await handlers.createDraft(new Request("https://app.test/api/admin/strategies", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify(draft),
  }));
  const created = await createdResponse.json() as { card: { id: string }; version: { version: number } };
  const response = await handlers.actionVersion(
    new Request("https://app.test/api/admin/strategies/x/versions/1/actions", {
      method: "POST",
      headers: { origin: "https://app.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "activate", expectedRevision: 0, expiresInDays: 30 }),
    }),
    created.card.id,
    created.version.version,
  );
  assert.equal(response.status, 409);
  const body = await response.json() as { error: string; message: string };
  assert.equal(body.error, "invalid_transition");
  assert.doesNotMatch(JSON.stringify(body), /用具体结果/);
});
