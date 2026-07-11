import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("editorial workbench exposes shared tokens and navigation", async () => {
  const [css, header, home, dashboard] = await Promise.all([
    source("app/globals.css"),
    source("components/AppHeader.tsx"),
    source("app/page.tsx"),
    source("app/dashboard/DashboardClient.tsx"),
  ]);

  assert.match(css, /--color-canvas:\s*#f5f5f3/i);
  assert.match(css, /--color-accent:\s*#e4002b/i);
  assert.doesNotMatch(css, /linear-gradient\(#d9d9d9 1px/);
  assert.match(header, /href="\/dashboard"/);
  assert.match(header, /aria-current/);
  assert.match(home, /<AppHeader/);
  assert.match(dashboard, /<AppHeader/);
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

test("dashboard groups metrics around operational decisions", async () => {
  const dashboard = await source("app/dashboard/DashboardClient.tsx");

  assert.match(dashboard, /生成健康度/);
  assert.match(dashboard, /内容价值/);
  assert.match(dashboard, /人工反馈/);
  assert.match(dashboard, /overflow-x-auto/);
});
