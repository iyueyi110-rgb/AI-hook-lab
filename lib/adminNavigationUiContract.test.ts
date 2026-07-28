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
