import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("home hides the coach mode switch behind the public flag and preserves classic mode", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /NEXT_PUBLIC_AGENT_COACH_ENABLED/);
  assert.match(page, /经典生成/);
  assert.match(page, /创作教练/);
  assert.match(page, /mode === "classic"/);
  assert.match(page, /<InputPanel/);
  assert.match(page, /<CreativeCoachWorkspace/);
});

test("creative coach hook owns revision, aborts superseded requests and refreshes 409 without replay", async () => {
  const hook = await source("hooks/useCreativeCoach.ts");
  assert.match(hook, /expectedRevision/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /\.status === 409/);
  assert.match(hook, /refreshRun/);
  assert.doesNotMatch(hook, /response\.status === 409[\s\S]{0,500}submitCommand\(/);
});

test("coach workspace has responsive three-column, drawer and full-screen accessibility contracts", async () => {
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  assert.match(workspace, /xl:grid-cols-\[minmax\(280px,0\.72fr\)_minmax\(0,1\.28fr\)_360px\]/);
  assert.match(workspace, /max-xl:fixed/);
  assert.match(workspace, /max-md:inset-0/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /aria-modal/);
  assert.match(workspace, /allowedCommands/);
  assert.match(workspace, /needsInput/);
  assert.match(workspace, /xl:!hidden/);
  assert.match(workspace, /openButtonRef\.current\?\.focus/);
});

test("coach image, memory and finalized history flows stay on their intended boundaries", async () => {
  const hook = await source("hooks/useCreativeCoach.ts");
  const workspace = await source("components/CreativeCoachWorkspace.tsx");
  const page = await source("app/page.tsx");
  assert.match(hook, /buildCoachEndpoint\("image"/);
  assert.doesNotMatch(hook, /\/api\/analyze-image/);
  assert.match(hook, /deleteMemory/);
  assert.match(hook, /clearMemory/);
  assert.match(workspace, /本轮忽略/);
  assert.match(page, /addToHistory\(response\)/);
  assert.match(workspace, /run\?\.status === "analyzing_image"/);
  assert.match(workspace, /retryImageOperation/);
});

test("classic Hook cards remain default while coach actions are optional", async () => {
  const grid = await source("components/HookGrid.tsx");
  const card = await source("components/HookCard.tsx");
  assert.match(grid, /coachActions\?/);
  assert.match(card, /onRewrite\?/);
  assert.match(card, /onSelect\?/);
  assert.match(card, /coachActions \?/);
  assert.match(grid, /canReject/);
  assert.match(grid, /!coachActions\.canReject/);
});
