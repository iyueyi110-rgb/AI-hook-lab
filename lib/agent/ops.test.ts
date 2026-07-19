import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { summarizeDashboardEvents } from "../dashboardStore";
import type { EvaluationState } from "../evaluation/types";
import type { EvaluationUser } from "../evaluation/types";
import { createOpsAgentHttpHandlers } from "./ops-http.ts";
import { createDeepSeekOpsProvider, type OpsProvider, type OpsProviderMessage } from "./ops-provider.ts";
import { OPS_AGENT_EVAL_CASES } from "./ops-evaluation.ts";
import { JsonOpsAgentRepository, OpsSessionConflictError } from "./ops-repository.ts";
import { OpsAgentService } from "./ops-service.ts";
import { createOpsToolExecutor, OPS_TOOL_DEFINITIONS } from "./ops-tools.ts";
import { OpsAnswerValidationError, parseOpsAgentAnswer, type OpsToolObservation } from "./ops-types.ts";

function state(): EvaluationState {
  return {
    schemaVersion: 1, users: [], sessions: [], cases: [], runs: [], auditLog: [],
    promptVersions: [
      { id: "a", version: "v1.0", name: "Baseline", role: "baseline", promptContent: "line a", changeSummary: "baseline", modelName: "deepseek-chat", modelParameters: {}, contentHash: "a", createdAt: "2026-07-01T00:00:00Z" },
      { id: "b", version: "v1.1", name: "Candidate", role: "candidate", promptContent: "line b", changeSummary: "candidate", modelName: "deepseek-chat", modelParameters: {}, contentHash: "b", createdAt: "2026-07-02T00:00:00Z" },
    ],
  };
}

test("ops answer validator requires evidence for complete and numeric findings", () => {
  assert.throws(() => parseOpsAgentAnswer({ status: "complete", summary: "done", sources: [], findings: [], risks: [], recommendations: [], caveats: [], followUpQuestions: [] }, new Set()), OpsAnswerValidationError);
  assert.throws(() => parseOpsAgentAnswer({ status: "partial", summary: "partial", sources: [], findings: [{ title: "rate", detail: "提升 12%", sourceIds: [] }], risks: [], recommendations: [], caveats: [], followUpQuestions: [] }, new Set()), /numeric findings require a source/);
});

test("ops launch evaluation inventory contains twelve domain and six safety scenarios", () => {
  assert.equal(OPS_AGENT_EVAL_CASES.length, 18);
  assert.equal(OPS_AGENT_EVAL_CASES.filter((item) => item.kind === "domain").length, 12);
  assert.equal(OPS_AGENT_EVAL_CASES.filter((item) => item.kind === "safety").length, 6);
  assert.equal(new Set(OPS_AGENT_EVAL_CASES.map((item) => item.id)).size, 18);
  const coveredTools = new Set(OPS_AGENT_EVAL_CASES.flatMap((item) => item.expectedTools));
  assert.deepEqual([...coveredTools].sort(), OPS_TOOL_DEFINITIONS.map((item) => item.function.name).sort());
  assert.ok(OPS_AGENT_EVAL_CASES.every((item) => item.forbiddenBehavior.length > 0 && item.allowedStatuses.length > 0));
});

test("ops tools reject unknown fields and never claim cross-run comparability", async () => {
  const execute = createOpsToolExecutor({
    now: () => new Date("2026-07-19T00:00:00Z"),
    getEvaluationState: async () => state(),
    getDashboardSummary: async (origin, filters) => summarizeDashboardEvents([], origin, filters),
  });
  const invalid = await execute("listEvaluationRuns", { unexpected: true }, "admin");
  assert.equal(invalid.status, "error");
  if (invalid.status === "error") assert.equal(invalid.error.code, "invalid_arguments");
  const comparison = await execute("comparePromptVersions", { versionA: "v1.0", versionB: "v1.1" }, "admin");
  assert.equal(comparison.status, "success");
  if (comparison.status === "success") assert.equal((comparison.data as { comparability: string }).comparability, "insufficient");
  const denied = await execute("getPromptVersionHistory", {}, "evaluator");
  assert.equal(denied.status, "error");
  if (denied.status === "error") assert.equal(denied.error.code, "permission_denied");
});

test("dashboard tool validates paired RFC 3339 bounds", async () => {
  const execute = createOpsToolExecutor({
    now: () => new Date("2026-07-19T00:00:00Z"),
    getEvaluationState: async () => state(),
    getDashboardSummary: async (origin, filters) => summarizeDashboardEvents([], origin, filters),
  });
  const result = await execute("getDashboardSummary", { from: "2026-07-01T00:00:00Z" }, "admin");
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.error.code, "invalid_arguments");
});

test("DeepSeek provider uses native tools and preserves tool call ids", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = createDeepSeekOpsProvider({ apiKey: "test-key", fetch: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "call-7", type: "function", function: { name: "listEvaluationRuns", arguments: "{}" } }] } }], usage: { prompt_tokens: 9, completion_tokens: 4 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  const result = await provider.complete({ messages: [{ role: "user", content: "runs" }], tools: OPS_TOOL_DEFINITIONS });
  assert.equal(result.toolCalls[0]?.id, "call-7");
  assert.equal(result.assistantMessage.tool_calls?.[0]?.function.name, "listEvaluationRuns");
  assert.ok(Array.isArray(requestBody?.tools));
  assert.equal(requestBody?.response_format, undefined);

  const finalProvider = createDeepSeekOpsProvider({ apiKey: "test-key", fetch: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"status":"partial"}' } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  await finalProvider.complete({ messages: [{ role: "user", content: "return json" }], tools: [] });
  assert.deepEqual(requestBody?.response_format, { type: "json_object" });

  let fetchCalls = 0;
  const abortedProvider = createDeepSeekOpsProvider({
    apiKey: "test-key",
    fetch: async () => {
      fetchCalls += 1;
      return new Response("unexpected", { status: 500 });
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => abortedProvider.complete({ messages: [{ role: "user", content: "runs" }], tools: [], signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "OpsProviderError" && (error as { code?: string }).code === "timeout",
  );
  assert.equal(fetchCalls, 0);
});

test("ops service executes a native tool loop and persists owner-scoped evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ops-agent-service-"));
  const repository = new JsonOpsAgentRepository(path.join(directory, "store.json"));
  let calls = 0;
  const provider: OpsProvider = {
    async complete(input) {
      calls += 1;
      if (calls === 1) {
        const assistantMessage: Extract<OpsProviderMessage, { role: "assistant" }> = { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "getDashboardSummary", arguments: "{}" } }] };
        return { content: null, toolCalls: [{ id: "call-1", name: "getDashboardSummary", arguments: "{}" }], assistantMessage, usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 0 } };
      }
      const toolMessage = [...input.messages].reverse().find((item) => item.role === "tool") as Extract<OpsProviderMessage, { role: "tool" }>;
      const observation = JSON.parse(toolMessage.content) as Extract<OpsToolObservation, { status: "success" }>;
      const answer = { status: "complete", summary: "看板数据已读取", sources: [observation.source], findings: [{ title: "样本", detail: "共有 1 条记录", sourceIds: [observation.source.id] }], risks: [], recommendations: [], caveats: [], followUpQuestions: [] };
      return { content: JSON.stringify(answer), toolCalls: [], assistantMessage: { role: "assistant", content: JSON.stringify(answer) }, usage: { inputTokens: 20, outputTokens: 8, cachedInputTokens: 2 } };
    },
  };
  const toolExecutor = async (): Promise<OpsToolObservation> => ({ status: "success", tool: "getDashboardSummary", source: { id: "source-1", label: "看板", origin: "real_user", asOf: "2026-07-19T00:00:00Z", filters: {} }, sampleSize: 1, caveats: [], data: { total: 1 } });
  const service = new OpsAgentService(repository, provider, toolExecutor, () => new Date("2026-07-19T00:00:00Z"));
  const result = await service.submitTurn({ ownerUserId: "admin-1", actorRole: "admin", message: "概览" });
  assert.equal(result.answer.status, "complete");
  assert.equal(result.answer.sources[0]?.id, "source-1");
  const restored = await service.getSession("admin-1", result.sessionId);
  assert.equal(restored.messages.length, 2);
  await assert.rejects(() => service.getSession("admin-2", result.sessionId), /会话不存在/);
});

test("JSON ops repository enforces optimistic revision", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ops-agent-revision-"));
  const repository = new JsonOpsAgentRepository(path.join(directory, "store.json"));
  const session = await repository.create("admin-1", new Date("2026-07-19T00:00:00Z"));
  await repository.save(session, 0);
  await assert.rejects(() => repository.save(session, 0), OpsSessionConflictError);
});

function user(role: EvaluationUser["role"]): EvaluationUser {
  return { id: `${role}-1`, username: role, displayName: role, passwordHash: "hash", passwordSalt: "salt", role, status: "active", failedLoginCount: 0, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" };
}

test("ops HTTP enforces feature flag, same origin and admin role", async () => {
  const disabled = createOpsAgentHttpHandlers({ enabled: false, currentUser: async () => user("admin") });
  assert.equal((await disabled.get(new Request("https://app.test/api/agent/ops?sessionId=x"))).status, 404);

  const unauthenticated = createOpsAgentHttpHandlers({ enabled: true, currentUser: async () => null });
  assert.equal((await unauthenticated.get(new Request("https://app.test/api/agent/ops?sessionId=x"))).status, 401);

  const forbidden = createOpsAgentHttpHandlers({ enabled: true, currentUser: async () => user("evaluator") });
  assert.equal((await forbidden.get(new Request("https://app.test/api/agent/ops?sessionId=x"))).status, 403);

  const admin = createOpsAgentHttpHandlers({ enabled: true, currentUser: async () => user("admin") });
  const crossOrigin = new Request("https://app.test/api/agent/ops", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ message: "test" }) });
  assert.equal((await admin.post(crossOrigin)).status, 403);
});
