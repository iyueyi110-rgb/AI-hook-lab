import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";

const launcherUrl = new URL("../start-ai-hook-mac.command", import.meta.url);
const envExampleUrl = new URL("../.env.local.example", import.meta.url);

test("macOS launcher covers setup, port selection, readiness and cleanup", async () => {
  const source = await readFile(launcherUrl, "utf8");

  assert.match(source, /^#!\/bin\/bash/);
  assert.match(source, /BASH_SOURCE\[0\]/);
  assert.match(source, /command -v node/);
  assert.match(source, /command -v npm/);
  assert.match(source, /npm install/);
  assert.match(source, /\.env\.local\.example/);
  assert.match(source, /3000 3010 3011 3012 3020/);
  assert.match(source, /lsof/);
  assert.match(source, /curl/);
  assert.match(source, /find_existing_ai_hook_port/);
  assert.match(source, /复用已运行的 AI Hook Lab/);
  assert.match(source, /npm run dev -- -p/);
  assert.match(source, /open .*HOME_URL/);
  assert.match(source, /open .*DASHBOARD_URL/);
  assert.match(source, /\/dashboard/);
  assert.match(source, /trap cleanup/);
  assert.match(source, /AI_HOOK_SKIP_OPEN/);
});

test("macOS launcher and environment example are safe local artifacts", async () => {
  await access(launcherUrl, constants.X_OK);
  const mode = (await stat(launcherUrl)).mode;
  assert.notEqual(mode & 0o111, 0);

  const envExample = await readFile(envExampleUrl, "utf8");
  assert.match(envExample, /^DEEPSEEK_API_KEY=$/m);
  assert.match(envExample, /^DATABASE_URL=$/m);
  assert.match(envExample, /^EVAL_INGEST_TOKEN=$/m);
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9]/);
});
