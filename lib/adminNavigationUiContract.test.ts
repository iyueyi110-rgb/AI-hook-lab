import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("admin workspace header renders governed top navigation with current state", async () => {
  const source = await read("components/AdminWorkspaceHeader.tsx").catch(
    () => "",
  );
  assert.match(source, /getAdminNavigationItems/);
  assert.match(source, /usePathname/);
  assert.match(source, /isAdminNavigationItemCurrent/);
  assert.match(source, /aria-current/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /href="\//);
});

test("admin back link uses an explicit destination instead of browser history", async () => {
  const source = await read("components/AdminBackLink.tsx").catch(() => "");
  assert.match(source, /href/);
  assert.match(source, /label/);
  assert.match(source, /ArrowLeft/);
  assert.doesNotMatch(source, /router\.back|history\.back/);
});

test("governed admin pages share navigation and return to dashboard", async () => {
  for (const path of [
    "app/admin/dashboard/strategies/page.tsx",
    "app/admin/dashboard/agent/page.tsx",
  ]) {
    const source = await read(path);
    assert.match(source, /AdminWorkspaceHeader/);
    assert.match(source, /AdminBackLink/);
    assert.match(source, /href="\/admin"/);
    assert.match(source, /返回数据看板/);
    assert.doesNotMatch(source, /<AppHeader/);
  }
});

test("governed workspaces allow anonymous read-only rendering while keeping controls gated", async () => {
  const strategyPage = await read("app/admin/dashboard/strategies/page.tsx");
  const agentPage = await read("app/admin/dashboard/agent/page.tsx");
  const strategyClient = await read("components/StrategyAdminClient.tsx");
  const agentClient = await read("components/OpsAgentChat.tsx");

  for (const page of [strategyPage, agentPage]) {
    assert.match(page, /isPublicWorkspaceReadEnabled/);
    assert.match(page, /if \(!publicRead\)/);
    assert.match(page, /access !== "authorized"/);
  }
  assert.match(strategyClient, /readOnly/);
  assert.match(strategyClient, /公开只读模式/);
  assert.match(agentClient, /readOnly/);
  assert.match(agentClient, /公开只读模式/);
});

test("evaluation uses workspace navigation for admin and public read-only views", async () => {
  const page = await read("app/evaluation/page.tsx");
  const client = await read("app/evaluation/EvaluationClient.tsx");
  const runPage = await read("app/evaluation/runs/[runId]/page.tsx");
  const runClient = await read("app/evaluation/runs/[runId]/RunDetailClient.tsx");

  assert.match(page, /isPublicWorkspaceReadEnabled/);
  assert.match(page, /canManage \|\| publicRead/);
  assert.match(page, /adminNavigation/);
  assert.match(client, /adminNavigation \?/);
  assert.match(client, /AdminWorkspaceHeader/);
  assert.match(client, /返回数据看板/);
  assert.match(runPage, /isPublicWorkspaceReadEnabled/);
  assert.match(runPage, /runForPublic/);
  assert.match(runClient, /adminNavigation \?/);
  assert.match(runClient, /href="\/evaluation"/);
  assert.match(runClient, /返回评测概览/);
});
