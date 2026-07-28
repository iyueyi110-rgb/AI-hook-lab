import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("home exposes creative intents without a technical mode switch", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /NEXT_PUBLIC_AGENT_COACH_ENABLED/);
  assert.doesNotMatch(page, /setMode|mode === "classic"|aria-label="创作模式"/);
  assert.match(page, /handleClarify/);
  assert.match(page, /handlePolish/);
  assert.match(page, /<InputPanel/);
  assert.match(page, /<CreativeCoachWorkspace/);
});

test("the shared brief and result area expose progressive Agent actions", async () => {
  const input = await source("components/InputPanel.tsx");
  const grid = await source("components/HookGrid.tsx");
  assert.match(input, /帮我梳理/);
  assert.match(input, /生成 10 个候选/);
  assert.match(input, /onClarify/);
  assert.match(grid, /继续打磨/);
  assert.match(grid, /本轮由创作教练协助/);
  assert.match(grid, /onPolish/);
});

test("classic candidates cross an explicit typed conversion boundary before Agent polishing", async () => {
  const page = await source("app/page.tsx");
  const boundary = await source("lib/creativeWorkbench.ts");
  assert.match(page, /buildWorkbenchBrief/);
  assert.match(page, /hooksToSeedCandidates/);
  assert.match(page, /startPolishing/);
  assert.match(boundary, /Partial<CreativeBrief>/);
  assert.match(boundary, /Candidate\[\]/);
  assert.doesNotMatch(boundary, /fetch\(/);
});

test("the Agent workspace is a controlled hidden drawer rather than a third column", async () => {
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /open \?/);
  assert.match(workspace, /returnTarget\?\.focus/);
  assert.doesNotMatch(workspace, /xl:grid-cols-\[minmax\(280px/);
  assert.doesNotMatch(workspace, /<HookGrid/);
});

test("Creative Agent hook owns revision, timeouts and 409 refresh without replay", async () => {
  const hook = await source("hooks/useCreativeCoach.ts");
  assert.match(hook, /expectedRevision/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /\.status === 409/);
  assert.match(hook, /refreshRun/);
  assert.match(hook, /withCoachRequestTimeout/);
  assert.match(hook, /retryRestore/);
  assert.match(hook, /skipRestore/);
  assert.doesNotMatch(hook, /response\.status === 409[\s\S]{0,500}submitCommand\(/);
});

test("drawer preserves retry, cancellation, final confirmation and memory boundaries", async () => {
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  assert.match(workspace, /allowedCommands/);
  assert.match(workspace, /needsInput/);
  assert.match(workspace, /type: "retry"/);
  assert.match(workspace, /confirm_final/);
  assert.match(workspace, /cancelRun/);
  assert.match(workspace, /deleteMemory/);
  assert.match(workspace, /clearMemory/);
  assert.match(workspace, /重试恢复/);
  assert.match(workspace, /跳过恢复/);
});

test("drawer traps focus, closes with Escape and restores the opening focus", async () => {
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  assert.match(workspace, /previousFocusRef/);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /event\.key !== "Tab"/);
  assert.match(workspace, /shiftKey/);
  assert.match(workspace, /returnTarget\?\.focus/);
});

test("classic Hook cards remain default while coach actions stay optional", async () => {
  const grid = await source("components/HookGrid.tsx");
  const card = await source("components/HookCard.tsx");
  assert.match(grid, /coachActions\?/);
  assert.match(card, /onRewrite\?/);
  assert.match(card, /onSelect\?/);
  assert.match(card, /coachActions \?/);
  assert.match(card, /!coachActions &&/);
});

test("Agent candidates flow back to the shared result area and finalized history", async () => {
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  const page = await source("app/page.tsx");
  assert.match(workspace, /onCandidatesChange/);
  assert.match(workspace, /candidatesToHooks/);
  assert.match(page, /addToHistory\(response\)/);
  assert.match(page, /setHooks/);
  assert.match(page, /coachAssisted/);
});
