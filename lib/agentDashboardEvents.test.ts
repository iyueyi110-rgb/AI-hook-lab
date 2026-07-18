import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dashboardStoreUrl = new URL("./dashboardStore.ts", import.meta.url).href;
const registerUrl = new URL("../test/register-ts-extension-loader.mjs", import.meta.url).href;

test("agent dashboard events accept only aggregate allowlisted payloads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-dashboard-events-"));
  const script = `
    const { appendDashboardEvent } = await import(${JSON.stringify(dashboardStoreUrl)});
    const valid = [
      { type: "agent_run_start", payload: { status: "understanding", platform: "douyin", contentType: "video", memoryCount: 1 } },
      { type: "agent_clarification", payload: { status: "understanding", field: "topic", attempt: 1 } },
      { type: "agent_brief_confirmed", payload: { status: "generating", platform: "douyin", contentType: "video" } },
      { type: "agent_tool_call", payload: { status: "completed", tool: "generate_hooks", candidateCount: 10, durationMs: 1200 } },
      { type: "agent_revision", payload: { status: "revising", command: "rewrite_candidate", round: 1, candidateCount: 3 } },
      { type: "agent_final_confirmed", payload: { status: "completed", candidateCount: 1, durationMs: 3000 } },
      { type: "agent_memory_applied", payload: { status: "understanding", memoryCount: 2 } },
      { type: "agent_memory_deleted", payload: { scope: "single", memoryCount: 1 } },
    ];
    const invalid = [
      { type: "agent_run_start", payload: { status: "understanding", topic: "private topic" } },
      { type: "agent_clarification", payload: { status: "understanding", message: "private chat" } },
      { type: "agent_tool_call", payload: { status: "completed", tool: "generate_hooks", hook: "private hook" } },
      { type: "agent_tool_call", payload: { status: "completed", tool: "unknown_tool" } },
      { type: "agent_revision", payload: { status: "revising", command: "raw instruction" } },
      { type: "agent_memory_deleted", payload: { scope: "all", imageDescription: "private image" } },
    ];
    const accepted = [];
    for (const input of valid) accepted.push(await appendDashboardEvent({ ...input, dataOrigin: "real_user" }));
    const rejected = [];
    for (const input of invalid) {
      try { await appendDashboardEvent({ ...input, dataOrigin: "real_user" }); }
      catch { rejected.push(input.type); }
    }
    process.stdout.write(JSON.stringify({ accepted, rejected }));
  `;

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--experimental-strip-types",
      "--import",
      registerUrl,
      "--input-type=module",
      "-e",
      script,
    ], {
      cwd: directory,
      env: { ...process.env, DATABASE_URL: "", NODE_ENV: "development", VERCEL_ENV: "" },
    });
    const result = JSON.parse(stdout) as { accepted: Array<{ payload: Record<string, unknown> }>; rejected: string[] };
    assert.equal(result.accepted.length, 8);
    assert.equal(result.rejected.length, 6);
    assert.ok(result.accepted.every((event) => !Object.hasOwn(event.payload, "topic")));
    const persisted = JSON.parse(await readFile(path.join(directory, "data", "dashboard-events.json"), "utf8"));
    assert.equal(persisted.length, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
