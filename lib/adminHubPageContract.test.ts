import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin entry requires authentication and renders the four governed destinations", async () => {
  const source = await readFile(
    new URL("../app/admin/page.tsx", import.meta.url),
    "utf8",
  ).catch(() => "");

  assert.match(source, /classifyAdminAccess/);
  assert.match(source, /evaluation\/login\?next=%2Fadmin/);
  assert.match(source, /DatabaseUnavailablePanel/);
  assert.match(source, /getAdminHubItems/);
  assert.match(source, /item\.enabled/);
  assert.match(source, /当前未启用/);
});
