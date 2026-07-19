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
  cleanupExpiredAgentData,
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
import { AGENT_MIGRATIONS, runAgentMigrations } from "./migrations.ts";

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

test("cleanup deletes stale runs in every status but preserves a live operation lease", () => {
  const state = createInitialAgentState();
  state.creatorSessions.push({ id: "owner", tokenDigest: "digest", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" });
  state.runs.push(
    run("old", "owner", { status: "completed", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ id: "message", role: "user", content: "x", createdAt: "2026-01-01" }] }),
    run("abandoned", "owner", { status: "reviewing", updatedAt: "2026-01-01T00:00:00.000Z" }),
    run("leased", "owner", { status: "generating", updatedAt: "2026-01-01T00:00:00.000Z", activeOperation: { id: "op", kind: "generation", startedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:01:00.000Z" } }),
  );
  assert.deepEqual(cleanupStaleRuns(state, new Date("2026-02-01T00:00:00.000Z")), ["old", "abandoned"]);
  assert.deepEqual(state.runs.map((item) => item.id), ["leased"]);
});

test("cleanup expires sessions and cascades their runs and memory", () => {
  const state = createInitialAgentState();
  state.creatorSessions.push(
    { id: "expired", tokenDigest: "expired-digest", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2025-01-01T00:00:00.000Z" },
    { id: "live", tokenDigest: "live-digest", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" },
  );
  state.runs.push(run("expired-run", "expired", { updatedAt: "2026-01-31T00:00:00.000Z" }), run("live-run", "live", { updatedAt: "2026-01-31T00:00:00.000Z" }));
  state.memories.push(
    { creatorSessionId: "expired", memory: { entries: [{ key: "preferred_tone", value: "curious", confidence: 0.6 }] } },
    { creatorSessionId: "live", memory: { entries: [] } },
  );
  const result = cleanupExpiredAgentData(state, new Date("2026-02-01T00:00:00.000Z"));
  assert.deepEqual(result.removedSessionIds, ["expired"]);
  assert.deepEqual(result.removedRunIds, ["expired-run"]);
  assert.equal(result.removedMemoryCount, 1);
  assert.deepEqual(state.runs.map((item) => item.id), ["live-run"]);
  assert.deepEqual(state.memories.map((item) => item.creatorSessionId), ["live"]);
});

test("normal repository operations persist stale terminal cleanup but retain active runs, sessions, and memory", async () => {
  const repository = new MemoryAgentRepository();
  let sessionId = "";
  await repository.transaction((state) => {
    const session = createCreatorSession(state).session;
    sessionId = session.id;
    recordCreatorMemory(state, session.id, { key: "default_platform", value: "douyin" });
    state.runs.push(run("old", session.id, { updatedAt: new Date().toISOString() }), run("active", session.id, { updatedAt: new Date().toISOString() }));
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
  state.runs.push(run("old", "session", { status: "failed", updatedAt: "2026-01-01T00:00:00.000Z" }), run("active", "session", { status: "generating", updatedAt: "2098-01-01T00:00:00.000Z" }));
  await writeFile(file, JSON.stringify(state), "utf8");
  const persisted = await new JsonAgentRepository(file).read();
  assert.deepEqual(persisted.runs.map((item) => item.id), ["active"]);
  assert.equal(persisted.creatorSessions.length, 1);
  assert.equal(persisted.memories.length, 1);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).runs.map((item: StoredAgentRun) => item.id), ["active"]);
});

test("explicit cleanup persists stale nonterminal and expired-session removal in JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const repository = new JsonAgentRepository(file);
  await repository.transaction((state) => {
    state.creatorSessions.push({ id: "expired", tokenDigest: "digest", createdAt: "2098-01-01T00:00:00.000Z", expiresAt: "2098-06-01T00:00:00.000Z", lastSeenAt: "2098-01-01T00:00:00.000Z" });
    state.runs.push(run("abandoned", "expired", { status: "reviewing", updatedAt: "2098-05-01T00:00:00.000Z" }));
    state.memories.push({ creatorSessionId: "expired", memory: { entries: [{ key: "preferred_tone", value: "curious", confidence: 0.6 }] } });
  });
  const result = await repository.cleanup(new Date("2099-02-01T00:00:00.000Z"));
  assert.equal(result.removedSessionIds.includes("expired"), true);
  assert.equal((await repository.read()).runs.length, 0);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(JSON.stringify(persisted).includes("curious"), false);
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

test("JSON read and write remove magic-detected base64 and base64url binary from ordinary content fields", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-store-"));
  const file = path.join(directory, "agent.json");
  const state = createInitialAgentState() as unknown as Record<string, unknown>;
  state.metadata = {
    content: "iVBORw0KGgoAAAANSUhEUgAAAAE",
    nested: { content: "_9j_4AAQSkZJRgABAQ" },
    gif: "R0lGODlhAQABAIAAAAAAAP///w",
    webp: "UklGRiIAAABXRUJQ",
    pdf: "JVBERi0xLjQK",
    prose: "This is ordinary text.",
  };
  await writeFile(file, JSON.stringify(state), "utf8");
  const stored = await new JsonAgentRepository(file).read() as unknown as Record<string, unknown>;
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes("iVBORw0KGgo"), false);
  assert.equal(serialized.includes("_9j_4AAQ"), false);
  assert.equal(serialized.includes("R0lGODlh"), false);
  assert.equal(serialized.includes("UklGRiIAAABXRUJQ"), false);
  assert.equal(serialized.includes("JVBERi0xLjQK"), false);
  assert.equal(serialized.includes("This is ordinary text."), true);
  assert.equal((await readFile(file, "utf8")).includes("iVBORw0KGgo"), false);
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
  assert.match(AGENT_SCHEMA_SQL, /CONSTRAINT agent_run_creator_session_fk REFERENCES creator_session\(id\) ON DELETE CASCADE/);
  assert.match(AGENT_SCHEMA_SQL, /CONSTRAINT agent_message_run_fk REFERENCES agent_run\(id\) ON DELETE CASCADE/);
});

test("postgres persistence uses versioned shard migrations and scoped incremental projection writes", async () => {
  assert.deepEqual(AGENT_MIGRATIONS.map((migration) => migration.version), [1, 2]);
  assert.match(AGENT_MIGRATIONS[1]!.sql, /session:/);
  assert.match(AGENT_MIGRATIONS[1]!.sql, /DELETE FROM agent_state WHERE id = 'default'/);
  const source = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /WHERE id = 'default' FOR UPDATE/);
  assert.doesNotMatch(source, /DELETE FROM \$\{table\}(?!\s+WHERE)/);
  assert.match(source, /ORDER BY id FOR UPDATE/);
  assert.match(source, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(source, /deleteMissing\(client, "agent_run", "creator_session_id"/);
});

test("migration runner serializes upgrades and records schema version without a ninth table", async () => {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.startsWith("SELECT payload FROM agent_state")) return { rows: [] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  await runAgentMigrations({ async connect() { return client as never; } });
  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1]!, /pg_advisory_xact_lock/);
  assert.equal(queries.some((query) => query.includes("WITH legacy AS")), true);
  assert.equal(queries.some((query) => query.includes("'__schema__'")), true);
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(released, true);
  assert.equal(AGENT_SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS/g)?.length, 8);
});

test("tool call projection embeds the matching structured result without a ninth table", () => {
  const projected = buildToolCallProjection(run("run", "owner", { toolCalls: [{ id: "call", tool: "generate_hooks", status: "completed", createdAt: "2026-01-01", input: {} }], toolResults: [{ tool: "generate_hooks", status: "success", output: { count: 3 } }] }));
  assert.deepEqual(projected[0]?.result, { tool: "generate_hooks", status: "success", output: { count: 3 } });
  assert.doesNotMatch(AGENT_SCHEMA_SQL, /agent_tool_result/);
});

test("tool call projection uses call ids and legacy tool-order fallback for repeated tool names", () => {
  const projected = buildToolCallProjection(run("run", "owner", {
    toolCalls: [
      { id: "first", tool: "generate_hooks", status: "completed", createdAt: "2026-01-01", input: {} },
      { id: "second", tool: "generate_hooks", status: "completed", createdAt: "2026-01-02", input: {} },
    ],
    toolResults: [
      { tool: "generate_hooks", status: "success", output: { attempt: 2 }, callId: "second" },
      { tool: "generate_hooks", status: "error", error: { code: "failed", message: "first" } },
    ] as never,
  }));
  assert.equal(projected[0]?.result?.status, "error");
  assert.deepEqual(projected[1]?.result, { tool: "generate_hooks", status: "success", output: { attempt: 2 }, callId: "second" });
});

test("agent persistence uses postgres when configured and fails closed in production without it", () => {
  assert.equal(getPersistenceMode({}), "json");
  assert.equal(getPersistenceMode({ DATABASE_URL: "postgres://example" }), "postgres");
  assert.equal(getPersistenceMode({ NODE_ENV: "production" }), "unavailable");
});
