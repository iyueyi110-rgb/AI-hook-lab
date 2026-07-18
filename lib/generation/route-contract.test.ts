import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the generate route delegates model generation to the shared service", async () => {
  const route = await readFile(new URL("../../app/api/generate/route.ts", import.meta.url), "utf8");

  assert.match(route, /generateClassicHooks/);
  assert.doesNotMatch(route, /fetch\s*\(/);
  assert.doesNotMatch(route, /api\.deepseek\.com/);
});
