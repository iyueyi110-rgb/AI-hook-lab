import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("editorial workbench exposes shared tokens and navigation", async () => {
  const [css, header, home, evaluation, dashboard] = await Promise.all([
    source("app/globals.css"),
    source("components/AppHeader.tsx"),
    source("app/page.tsx"),
    source("app/evaluation/EvaluationClient.tsx"),
    source("app/admin/dashboard/DashboardClient.tsx"),
  ]);

  assert.match(css, /--color-canvas:\s*#f5f5f3/i);
  assert.match(css, /--color-accent:\s*#e4002b/i);
  assert.doesNotMatch(css, /linear-gradient\(#d9d9d9 1px/);
  assert.doesNotMatch(header, /href="\/dashboard"/);
  assert.doesNotMatch(header, /href="\/admin\/dashboard"/);
  assert.doesNotMatch(header, /href="\/evaluation"/);
  assert.match(header, /aria-current/);
  assert.match(home, /<AppHeader/);
  assert.match(
    evaluation,
    /initial\.user\.role === "admin"\s*&&\s*\(\s*<Link[^>]*href="\/admin\/dashboard"/s,
  );
  assert.match(dashboard, /<AppHeader/);
  assert.match(dashboard, /href="\/evaluation"/);
});

test("results and drawers follow the approved product interaction contract", async () => {
  const [grid, card, drawer, history, favorites] = await Promise.all([
    source("components/HookGrid.tsx"),
    source("components/HookCard.tsx"),
    source("components/DrawerShell.tsx"),
    source("components/HistoryDrawer.tsx"),
    source("components/FavoritesDrawer.tsx"),
  ]);

  assert.match(grid, /featured/);
  assert.match(card, /最佳候选/);
  assert.match(card, /details/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(history, /<DrawerShell/);
  assert.match(favorites, /<DrawerShell/);
});

test("platform and content choices expose a visible pressed state", async () => {
  const [css, inputPanel] = await Promise.all([
    source("app/globals.css"),
    source("components/InputPanel.tsx"),
  ]);

  assert.match(inputPanel, /choice-button/);
  assert.match(css, /\.control-base\.choice-button\[aria-pressed="true"\]\s*\{[^}]*border-color:\s*var\(--color-accent\)[^}]*background:\s*var\(--color-accent-soft\)[^}]*color:\s*var\(--color-accent\)/s);
});

test("image upload exposes an accessible preview and analysis contract", async () => {
  const inputPanel = await source("components/InputPanel.tsx");

  assert.match(inputPanel, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(inputPanel, /onDrop=/);
  assert.match(inputPanel, /imagePreviewUrl/);
  assert.match(inputPanel, /正在识别/);
  assert.match(inputPanel, /role="alert"/);
  assert.match(inputPanel, /豆包/);
  assert.match(inputPanel, />荐</);
});

test("home cancels stale image requests and keeps image data out of persistence", async () => {
  const home = await source("app/page.tsx");

  assert.match(home, /new FormData\(\)/);
  assert.match(home, /new AbortController\(\)/);
  assert.match(home, /URL\.createObjectURL/);
  assert.match(home, /URL\.revokeObjectURL/);
  assert.match(home, /imageRequestIdRef/);
  assert.match(home, /touchedSinceUploadRef/);
  assert.match(home, /imageAnalysis\?\.imageDescription/);
  assert.doesNotMatch(home, /track\([^)]*imageDescription/s);
  assert.doesNotMatch(home, /addToHistory\([^)]*imageAnalysis/s);
});

test("dashboard groups metrics around operational decisions", async () => {
  const dashboard = await source("app/admin/dashboard/DashboardClient.tsx");

  assert.match(dashboard, /生成健康度/);
  assert.match(dashboard, /内容价值/);
  assert.match(dashboard, /人工反馈/);
  assert.match(dashboard, /overflow-x-auto/);
});

test("creator feedback uses an accessible skippable dialog and explicit rejection entry", async () => {
  const [dialog, grid, home, dashboard] = await Promise.all([
    source("components/CreatorFeedbackDialog.tsx"),
    source("components/HookGrid.tsx"),
    source("app/page.tsx"),
    source("app/admin/dashboard/DashboardClient.tsx"),
  ]);

  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /跳过/);
  assert.match(dialog, /maxLength=\{100\}/);
  assert.match(grid, /这批都不合适/);
  assert.match(home, /sampled_before_regenerate/);
  assert.match(home, /low_satisfaction/);
  assert.match(home, /creator_feedback/);
  assert.match(dashboard, /创作者真实反馈/);
  assert.match(dashboard, /模型判断 × 人工原因/);
  assert.match(dashboard, /URLSearchParams/);
  assert.match(dashboard, /void loadSummary\(\{ platform:/);
  assert.match(dashboard, /void loadSummary\(\{ trigger:/);
});
