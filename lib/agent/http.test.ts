import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { GenerateResponse } from "../types.ts";
import { MemoryAgentRepository } from "./repository.ts";
import { createCreativeCoachService, type CoachGenerationRequest } from "./service.ts";
import { createAgentHttpHandlers } from "./http.ts";
import { DEFAULT_AGENT_QUOTA } from "./quota.ts";

const origin = "http://localhost:3000";
const brief = { topic: "AI 周报", platform: "douyin", contentType: "video" };

function generated(request: CoachGenerationRequest): GenerateResponse {
  return {
    hooks: Array.from({ length: request.count }, (_, index) => ({
      id: `${request.kind}-${index}`, text: `hook ${index}`, style: "反差", reasoning: `引用 hook ${index}`,
      scores: { impact: 8, platformFit: 8, actionability: 7, shareability: 7 }, overallScore: 8,
    })),
    generatedAt: "2026-07-18T00:00:00.000Z", topic: request.brief.topic,
    platform: request.brief.platform, contentType: request.brief.contentType,
  };
}

function setup() {
  let id = 0;
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(), generate: async (request) => generated(request),
    analyzeImage: async () => ({ topic: "图", imageDescription: "安全图片描述", suggestedPlatform: "douyin", suggestedContentType: "video", suggestedEmotionTone: "curious" }),
    id: (prefix) => `${prefix}-${++id}`,
  });
  return createAgentHttpHandlers({ service, enabled: true, production: false });
}

function jsonRequest(path: string, body: unknown, cookie?: string, method = "POST", requestOrigin = origin): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      ...(cookie ? { cookie } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function createRun(handlers: ReturnType<typeof setup>) {
  const response = await handlers.createRun(jsonRequest("/api/agent/runs", { brief }));
  const body = await response.json();
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { response, body, cookie };
}

test("feature-disabled endpoints are hidden and mutations require same origin", async () => {
  const disabled = createAgentHttpHandlers({ service: setup().service, enabled: false, production: false });
  assert.equal((await disabled.createRun(jsonRequest("/api/agent/runs", { brief }))).status, 404);
  const handlers = setup();
  assert.equal((await handlers.createRun(jsonRequest("/api/agent/runs", { brief }, undefined, "POST", "https://evil.example"))).status, 403);
  assert.equal((await handlers.createRun(new Request(`${origin}/api/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief }) }))).status, 403);
});

test("creates an HttpOnly 180-day SameSite session cookie and restores only owned runs", async () => {
  const handlers = setup();
  const created = await createRun(handlers);
  assert.equal(created.response.status, 200);
  const setCookie = created.response.headers.get("set-cookie")!;
  assert.match(setCookie, /^ai-hook-creator-session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Max-Age=15552000/i);
  assert.doesNotMatch(setCookie, /Secure/i);

  const restored = await handlers.getRun(new Request(`${origin}/api/agent/runs/${created.body.run.id}`, { headers: { cookie: created.cookie } }), created.body.run.id);
  assert.equal(restored.status, 200);
  const forged = await handlers.getRun(new Request(`${origin}/api/agent/runs/${created.body.run.id}`), created.body.run.id);
  assert.equal(forged.status, 404);
  const other = await createRun(handlers);
  const crossSession = await handlers.getRun(new Request(`${origin}/api/agent/runs/${created.body.run.id}`, { headers: { cookie: other.cookie } }), created.body.run.id);
  assert.equal(crossSession.status, 404);
});

test("validates the strict turn union, message size, state, and expected revision", async () => {
  const handlers = setup();
  const created = await createRun(handlers);
  const id = created.body.run.id;
  const invalid = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 0, command: { type: "made_up" } }, created.cookie), id);
  assert.equal(invalid.status, 400);
  const extra = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 0, command: { type: "confirm_brief", extra: true } }, created.cookie), id);
  assert.equal(extra.status, 400);
  const stale = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 99, command: { type: "confirm_brief" } }, created.cookie), id);
  assert.equal(stale.status, 409);
  const long = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 0, command: { type: "message", text: "x".repeat(2001) } }, created.cookie), id);
  assert.equal(long.status, 413);
});

test("confirm_brief accepts only a strict optional brief patch", async () => {
  const handlers = setup();
  const created = await createRun(handlers);
  const id = created.body.run.id;
  const accepted = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, {
    expectedRevision: 0,
    command: { type: "confirm_brief", briefPatch: { imageDescription: "用户确认的图片内容" } },
  }, created.cookie), id);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).run.brief.imageDescription, "用户确认的图片内容");

  const second = await createRun(handlers);
  const rejected = await handlers.turn(jsonRequest(`/api/agent/runs/${second.body.run.id}/turns`, {
    expectedRevision: 0,
    command: { type: "confirm_brief", briefPatch: { imageDescription: "安全描述", unknown: "no" } },
  }, second.cookie), second.body.run.id);
  assert.equal(rejected.status, 400);
});

test("turn responses use the unified contract and cancellation is revision checked", async () => {
  const handlers = setup();
  const created = await createRun(handlers);
  const id = created.body.run.id;
  const turn = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 0, command: { type: "confirm_brief" } }, created.cookie), id);
  const body = await turn.json();
  assert.equal(turn.status, 200);
  for (const field of ["run", "messages", "candidates", "pendingConfirmation", "allowedCommands", "needsInput"]) assert.ok(field in body);
  const staleCancel = await handlers.deleteRun(jsonRequest(`/api/agent/runs/${id}?expectedRevision=0`, {}, created.cookie, "DELETE"), id);
  assert.equal(staleCancel.status, 409);
  const missingRevision = await handlers.deleteRun(jsonRequest(`/api/agent/runs/${id}`, {}, created.cookie, "DELETE"), id);
  assert.equal(missingRevision.status, 400);
  const cancelled = await handlers.deleteRun(jsonRequest(`/api/agent/runs/${id}?expectedRevision=${body.run.revision}`, {}, created.cookie, "DELETE"), id);
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).run.status, "cancelled");
});

test("uploads bounded multipart images with an expected revision", async () => {
  const handlers = setup();
  const createdResponse = await handlers.createRun(jsonRequest("/api/agent/runs", { brief, hasImage: true }));
  const created = await createdResponse.json();
  const cookie = createdResponse.headers.get("set-cookie")!.split(";")[0]!;
  const form = new FormData();
  form.set("expectedRevision", "0");
  form.set("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" }));
  const response = await handlers.image(new Request(`${origin}/api/agent/runs/${created.run.id}/image`, { method: "POST", headers: { origin, cookie }, body: form }), created.run.id);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).run.status, "awaiting_brief_confirmation");
  const missingRevision = new FormData();
  missingRevision.set("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "image.jpg", { type: "image/jpeg" }));
  assert.equal((await handlers.image(new Request(`${origin}/api/agent/runs/${created.run.id}/image`, { method: "POST", headers: { origin, cookie }, body: missingRevision }), created.run.id)).status, 400);
});

test("memory endpoints expose identifiers, delete one item, and clear all", async () => {
  const handlers = setup();
  const created = await createRun(handlers);
  const id = created.body.run.id;
  const reviewed = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: 0, command: { type: "confirm_brief" } }, created.cookie), id);
  const reviewBody = await reviewed.json();
  const selected = await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: reviewBody.run.revision, command: { type: "select_candidate", candidateId: reviewBody.candidates[0].id } }, created.cookie), id);
  const selectedBody = await selected.json();
  await handlers.turn(jsonRequest(`/api/agent/runs/${id}/turns`, { expectedRevision: selectedBody.run.revision, command: { type: "confirm_final" } }, created.cookie), id);
  const memoryResponse = await handlers.getMemory(new Request(`${origin}/api/agent/memory`, { headers: { cookie: created.cookie } }));
  const memory = await memoryResponse.json();
  assert.ok(memory.entries[0].id);
  assert.equal((await handlers.deleteMemory(jsonRequest(`/api/agent/memory/${memory.entries[0].id}`, {}, created.cookie, "DELETE"), memory.entries[0].id)).status, 200);
  assert.equal((await handlers.clearMemory(jsonRequest("/api/agent/memory", {}, created.cookie, "DELETE"))).status, 200);
  assert.deepEqual(await (await handlers.getMemory(new Request(`${origin}/api/agent/memory`, { headers: { cookie: created.cookie } }))).json(), { entries: [] });
});

test("rejects oversized JSON before parsing", async () => {
  const handlers = setup();
  const response = await handlers.createRun(new Request(`${origin}/api/agent/runs`, {
    method: "POST", headers: { origin, "content-type": "application/json", "content-length": "70000" }, body: JSON.stringify({ brief }),
  }));
  assert.equal(response.status, 413);
});

test("stops a chunked JSON body at the 64KB limit without buffering the rest", async () => {
  const handlers = setup();
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      if (pulls === 10) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const response = await handlers.createRun(new Request(`${origin}/api/agent/runs`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6);
});

test("stops a chunked multipart body before unbounded formData buffering", async () => {
  const handlers = setup();
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (pulls === 10) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const response = await handlers.image(new Request(`${origin}/api/agent/runs/run/image`, {
    method: "POST",
    headers: { origin, "content-type": "multipart/form-data; boundary=x", cookie: "ai-hook-creator-session=fake" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" }), "run");
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 7);
});

test("maps unavailable database connections to a structured 503", async () => {
  const unavailable = createAgentHttpHandlers({
    enabled: true,
    production: true,
    service: { createRun: async () => { throw Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }); } } as never,
  });
  const response = await unavailable.createRun(jsonRequest("/api/agent/runs", { brief }));
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["error", "message"]);
});

test("production model wiring shares the Agent turn budget and the route window is larger", async () => {
  const serviceSource = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  const httpSource = await readFile(new URL("./http.ts", import.meta.url), "utf8");
  const routeSource = await readFile(
    new URL("../../app/api/agent/runs/[runId]/turns/route.ts", import.meta.url),
    "utf8",
  );
  const turnTimeout = serviceSource.match(/export const DEFAULT_AGENT_TURN_TIMEOUT_MS\s*=\s*([\d_]+)/);
  const routeDuration = routeSource.match(/export const maxDuration\s*=\s*(\d+)/);

  assert.ok(turnTimeout, "Agent service must export its turn timeout contract");
  assert.ok(routeDuration, "turn route must export a literal maxDuration");
  assert.ok(Number(routeDuration[1]) * 1_000 > Number(turnTimeout[1]!.replaceAll("_", "")));
  assert.match(httpSource, /generate:\s*\(request,\s*execution\)\s*=>[\s\S]*?generateCoachHooks\(request,\s*\{[^}]*timeoutMs:\s*execution\.timeoutMs/);
  assert.match(httpSource, /decideBriefPatch:\s*\(request,\s*execution\)\s*=>[\s\S]*?decideBriefPatch\(request,\s*\{[^}]*timeoutMs:\s*execution\.timeoutMs/);
});

test("scheduled cleanup is hidden without configuration and requires its bearer secret", async () => {
  const service = setup().service!;
  const hidden = createAgentHttpHandlers({ service, enabled: true, env: {} as NodeJS.ProcessEnv });
  assert.equal((await hidden.cleanup(new Request(`${origin}/api/agent/cleanup`, { method: "POST" }))).status, 404);

  const handlers = createAgentHttpHandlers({ service, enabled: true, env: { NODE_ENV: "test", AGENT_CLEANUP_TOKEN: "cleanup-secret" } as NodeJS.ProcessEnv });
  assert.equal((await handlers.cleanup(new Request(`${origin}/api/agent/cleanup`, { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
  const response = await handlers.cleanup(new Request(`${origin}/api/agent/cleanup`, { method: "POST", headers: { authorization: "Bearer cleanup-secret" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["removedMemory", "removedRuns", "removedSessions", "removedUsage"]);
});

test("production requires an IP hash secret and same-IP cookie rotation cannot bypass quotas", async () => {
  let id = 0;
  const service = createCreativeCoachService({
    repository: new MemoryAgentRepository(),
    generate: async (request) => generated(request),
    analyzeImage: async () => ({ topic: "image", imageDescription: "safe", suggestedPlatform: "douyin", suggestedContentType: "video", suggestedEmotionTone: "curious" }),
    id: (prefix) => `${prefix}-${++id}`,
    quotaConfig: { ...DEFAULT_AGENT_QUOTA, ipRunCreates: 2, sessionRunCreates: 5, maxActiveRunsPerSession: 5 },
  });
  const missingSecret = createAgentHttpHandlers({ service, enabled: true, production: true, env: { NODE_ENV: "production" } as NodeJS.ProcessEnv });
  assert.equal((await missingSecret.createRun(jsonRequest("/api/agent/runs", { brief }))).status, 503);

  const handlers = createAgentHttpHandlers({
    service,
    enabled: true,
    production: true,
    env: { NODE_ENV: "production", AGENT_IP_HASH_SECRET: "test-ip-secret" } as NodeJS.ProcessEnv,
  });
  const first = await handlers.createRun(jsonRequest("/api/agent/runs", { brief }));
  const second = await handlers.createRun(jsonRequest("/api/agent/runs", { brief }));
  const rejected = await handlers.createRun(jsonRequest("/api/agent/runs", { brief }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(rejected.status, 429);
  assert.match(rejected.headers.get("retry-after") ?? "", /^\d+$/);
});
