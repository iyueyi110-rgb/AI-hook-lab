import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getPersistenceMode } from "../persistence.ts";
import { AgentConflictError } from "./index.ts";
import {
  AgentNotFoundError,
  AgentMemoryValidationError,
  CreatorSessionNotFoundError,
  JsonAgentRepository,
  MemoryAgentRepository,
  UnsupportedAgentSchemaError,
  assertOwnedRunRevision,
  cleanupStaleRuns,
  createCreatorSession,
  createInitialAgentState,
  deleteCreatorMemory,
  listCreatorMemory,
  recordCreatorMemory,
  resolveCreatorSession,
  buildToolCallProjection,
  validateAgentState,
  type StoredAgentRun,
} from "./repository.ts";
import { AGENT_SCHEMA_SQL } from "./schema.ts";

function run(id: string, creatorSessionId: string, overrides: Partial<StoredAgentRun> = {}): StoredAgentRun {
  return {
    id,
    creatorSessionId,
    revision: 0,
    status: "understanding" as const,
    messages: [],
    candidates: [],
    toolCalls: [],
    toolResults: [],
    approvals: [],
    memory: { entries: [] },
    summary: { messageCount: 0, latestMessageAt: undefined, candidateCount: 0, status: "understanding" },
    revisionRounds: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("memory repository contract persists only whitelisted memory for its creator session", async () => {
  const repository = new MemoryAgentRepository();
  let firstId = "";
  await repository.transaction((state) => {
    const first = createCreatorSession(state).session;
    const second = createCreatorSession(state).session;
    firstId = first.id;
    recordCreatorMemory(state, first.id, { key: "default_platform", value: "douyin" });
    recordCreatorMemory(state, second.id, { key: "preferred_tone", value: "curious" });
  });
  assert.deepEqual(listCreatorMemory(await repository.read(), firstId).entries, [{ key: "default_platform", value: "douyin", confidence: 0.6 }]);
  await repository.transaction((state) => deleteCreatorMemory(state, firstId, "default_platform", "douyin"));
  assert.deepEqual(listCreatorMemory(await repository.read(), firstId).entries, []);
});

test("memory CRUD rejects unknown keys and missing or expired sessions", () => {
  const state = createInitialAgentState();
  const session = createCreatorSession(state, new Date("2026-01-01T00:00:00.000Z")).session;
  assert.throws(() => recordCreatorMemory(state, "missing", { key: "default_platform", value: "douyin" }), CreatorSessionNotFoundError);
  assert.throws(() => recordCreatorMemory(state, session.id, { key: "unrecognized" as never, value: "douyin" }, new Date("2026-01-02T00:00:00.000Z")), AgentMemoryValidationError);
  assert.throws(() => deleteCreatorMemory(state, session.id, "unrecognized" as never, undefined, new Date("2026-07-01T00:00:00.000Z")), CreatorSessionNotFoundError);
});

test("json repository serializes concurrent transactions and atomically persists state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const repository = new JsonAgentRepository(file);
  await Promise.all(Array.from({ length: 20 }, (_, index) => repository.transaction((state) => {
    state.memories.push({ creatorSessionId: "session", memory: { entries: [{ key: "preferred_tone", value: "curious", confidence: index }] } });
  })));
  assert.equal((await repository.read()).memories.length, 20);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 1);
});

test("json repositories sharing a file serialize concurrent transactions across instances", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const left = new JsonAgentRepository(file);
  const right = new JsonAgentRepository(file);
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? left : right).transaction((state) => {
    state.memories.push({ creatorSessionId: `session-${index}`, memory: { entries: [] } });
  })));
  assert.equal((await left.read()).memories.length, 20);
});

test("creator sessions store digest only, expire after 180 days, and touch last seen", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const state = createInitialAgentState();
  const created = createCreatorSession(state, now);
  assert.equal(created.token.length, 43);
  assert.equal(state.creatorSessions[0]?.tokenDigest === created.token, false);
  const resolved = resolveCreatorSession(state, created.token, new Date("2026-01-02T00:00:00.000Z"));
  assert.equal(resolved?.id, created.session.id);
  assert.equal(resolved?.lastSeenAt, "2026-01-02T00:00:00.000Z");
  assert.equal(resolveCreatorSession(state, created.token, new Date("2026-07-01T00:00:00.000Z")), undefined);
});

test("run ownership hides missing and other-session runs, while stale revisions conflict", () => {
  const state = createInitialAgentState();
  state.runs.push(run("run-a", "owner"));
  assert.throws(() => assertOwnedRunRevision(state, "missing", "owner", 0), AgentNotFoundError);
  assert.throws(() => assertOwnedRunRevision(state, "run-a", "other", 0), AgentNotFoundError);
  assert.throws(() => assertOwnedRunRevision(state, "run-a", "owner", 1), AgentConflictError);
});

test("cleanup deletes only stale terminal runs and all their nested data", () => {
  const state = createInitialAgentState();
  state.runs.push(
    run("old", "owner", { status: "completed", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ id: "message", role: "user", content: "x", createdAt: "2026-01-01" }] }),
    run("active", "owner", { status: "generating", updatedAt: "2026-01-01T00:00:00.000Z" }),
  );
  assert.deepEqual(cleanupStaleRuns(state, new Date("2026-02-01T00:00:00.000Z")), ["old"]);
  assert.deepEqual(state.runs.map((item) => item.id), ["active"]);
});

test("normal repository operations persist stale terminal cleanup but retain active runs, sessions, and memory", async () => {
  const repository = new MemoryAgentRepository();
  let sessionId = "";
  await repository.transaction((state) => {
    const session = createCreatorSession(state).session;
    sessionId = session.id;
    recordCreatorMemory(state, session.id, { key: "default_platform", value: "douyin" });
    state.runs.push(run("old", session.id), run("active", session.id));
  });
  await repository.transaction((state) => {
    const old = state.runs.find((item) => item.id === "old")!;
    old.status = "completed";
    old.updatedAt = "2026-01-01T00:00:00.000Z";
  });
  const state = await repository.read();
  assert.deepEqual(state.runs.map((item) => item.id), ["active"]);
  assert.equal(state.creatorSessions.length, 1);
  assert.equal(listCreatorMemory(state, sessionId).entries.length, 1);
});

test("JSON reads persist stale cleanup while retaining session and memory state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const state = createInitialAgentState();
  state.creatorSessions.push({ id: "session", tokenDigest: "digest", createdAt: "2026-01-01", expiresAt: "2099-01-01", lastSeenAt: "2026-01-01" });
  state.memories.push({ creatorSessionId: "session", memory: { entries: [{ key: "default_platform", value: "douyin", confidence: 0.6 }] } });
  state.runs.push(run("old", "session", { status: "failed", updatedAt: "2026-01-01T00:00:00.000Z" }), run("active", "session", { status: "generating", updatedAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(file, JSON.stringify(state), "utf8");
  const persisted = await new JsonAgentRepository(file).read();
  assert.deepEqual(persisted.runs.map((item) => item.id), ["active"]);
  assert.equal(persisted.creatorSessions.length, 1);
  assert.equal(persisted.memories.length, 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).runs.map((item: StoredAgentRun) => item.id), ["active"]);
});

test("persistence retains the most recent 20 messages and a structured summary", async () => {
  const repository = new MemoryAgentRepository();
  await repository.transaction((state) => {
    state.runs.push(run("run", "owner", { messages: Array.from({ length: 21 }, (_, index) => ({ id: String(index), role: "user" as const, content: String(index), createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z` })) }));
  });
  const stored = (await repository.read()).runs[0]!;
  assert.deepEqual(stored.messages.map((message) => message.id), Array.from({ length: 20 }, (_, index) => String(index + 1)));
  assert.deepEqual(stored.summary, { messageCount: 21, latestMessageAt: "2026-01-01T00:00:20.000Z", candidateCount: 0, status: "understanding" });
});

test("persistence removes binary image payloads before they enter state or projections", async () => {
  const repository = new MemoryAgentRepository();
  await repository.transaction((state) => {
    state.runs.push(run("run", "owner", { toolCalls: [{ id: "call", tool: "analyze_image", status: "requested", createdAt: "2026-01-01", input: { image: "data:image/png;base64,abc", imageDescription: "a bright room" } }] }));
  });
  const input = (await repository.read()).runs[0]!.toolCalls[0]!.input;
  assert.equal("image" in input, false);
  assert.equal(input.imageDescription, "a bright room");
});

test("persistence cleans data URIs from every state branch regardless of MIME or casing", async () => {
  const repository = new MemoryAgentRepository();
  await repository.transaction((state) => {
    (state.creatorSessions as unknown as Array<Record<string, unknown>>).push({ id: "session", tokenDigest: "digest", expiresAt: "2099-01-01", lastSeenAt: "2026-01-01", createdAt: "2026-01-01", nested: { binary: "DATA:application/PDF;BASE64,abc" } });
    (state.memories as unknown as Array<Record<string, unknown>>).push({ creatorSessionId: "session", memory: { entries: [] }, attachment: "data:text/plain;base64,abc" });
    (state as unknown as Record<string, unknown>).metadata = { image: "data:image/WEBP;base64,abc", encodedBase64: "YmluYXJ5", bytes: Buffer.from([1, 2, 3]) };
  });
  const persisted = await repository.read() as unknown as Record<string, unknown>;
  assert.equal(JSON.stringify(persisted).toLowerCase().includes("data:"), false);
  assert.equal(JSON.stringify(persisted).includes("YmluYXJ5"), false);
});

test("unsupported or mismatched schema versions fail closed without rewriting JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const invalid = { ...createInitialAgentState(), schemaVersion: 2 };
  await writeFile(file, JSON.stringify(invalid), "utf8");
  const repository = new JsonAgentRepository(file);
  await assert.rejects(repository.read(), UnsupportedAgentSchemaError);
  await assert.rejects(repository.transaction(() => undefined), UnsupportedAgentSchemaError);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 2);
  assert.throws(() => validateAgentState(createInitialAgentState(), 2), UnsupportedAgentSchemaError);
});

test("memory repository rejects a future schema supplied by a transaction", async () => {
  const repository = new MemoryAgentRepository();
  await assert.rejects(repository.transaction((state) => { (state as unknown as { schemaVersion: number }).schemaVersion = 2; }), UnsupportedAgentSchemaError);
  assert.equal((await repository.read()).schemaVersion, 1);
});

test("agent schema defines all eight projections without raw images or token plaintext", () => {
  for (const table of ["agent_state", "creator_session", "agent_run", "agent_message", "agent_candidate", "agent_tool_call", "agent_approval", "creator_memory"]) {
    assert.match(AGENT_SCHEMA_SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(AGENT_SCHEMA_SQL, /raw_image|image_data|token\s+TEXT/i);
});

test("tool call projection embeds the matching structured result without a ninth table", () => {
  const projected = buildToolCallProjection(run("run", "owner", { toolCalls: [{ id: "call", tool: "generate_hooks", status: "completed", createdAt: "2026-01-01", input: {} }], toolResults: [{ tool: "generate_hooks", status: "success", output: { count: 3 } }] }));
  assert.deepEqual(projected[0]?.result, { tool: "generate_hooks", status: "success", output: { count: 3 } });
  assert.doesNotMatch(AGENT_SCHEMA_SQL, /agent_tool_result/);
});

test("agent persistence uses postgres when configured and fails closed in production without it", () => {
  assert.equal(getPersistenceMode({}), "json");
  assert.equal(getPersistenceMode({ DATABASE_URL: "postgres://example" }), "postgres");
  assert.equal(getPersistenceMode({ NODE_ENV: "production" }), "unavailable");
});
