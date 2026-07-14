import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonEvaluationRepository, createInitialEvaluationState } from "./repository.ts";

test("json repository seeds the canonical cases and immutable prompt versions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-hook-eval-"));
  const repository = new JsonEvaluationRepository(path.join(directory, "store.json"));
  await repository.initialize();
  const state = await repository.read();
  assert.equal(state.cases.length, 60);
  assert.deepEqual(state.promptVersions.map((item) => item.version), ["v1.0", "v1.1"]);
  assert.equal(state.schemaVersion, 1);
});

test("json transactions persist atomically without losing concurrent updates", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-hook-eval-"));
  const filePath = path.join(directory, "store.json");
  const repository = new JsonEvaluationRepository(filePath);
  await repository.initialize();
  await Promise.all([
    repository.transaction((state) => state.auditLog.push({ id: "a", action: "one", createdAt: new Date().toISOString() })),
    repository.transaction((state) => state.auditLog.push({ id: "b", action: "two", createdAt: new Date().toISOString() })),
  ]);
  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(persisted.auditLog.length, 2);
});

test("initial state never contains fabricated evaluation outcomes", () => {
  const state = createInitialEvaluationState();
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.users, []);
});
