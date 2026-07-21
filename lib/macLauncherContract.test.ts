import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const launcherUrl = new URL("../tools/start-ai-hook-mac.command", import.meta.url);
const labLauncherUrl = new URL("../tools/start-ai-hook-lab.bat", import.meta.url);
const dashboardLauncherUrl = new URL("../tools/start-ai-hook-dashboard.bat", import.meta.url);
const envExampleUrl = new URL("../.env.local.example", import.meta.url);
const execFileAsync = promisify(execFile);

test("macOS launcher covers setup, port selection, readiness and cleanup", async () => {
  const source = await readFile(launcherUrl, "utf8");

  assert.match(source, /^#!\/bin\/bash/);
  assert.match(source, /BASH_SOURCE\[0\]/);
  assert.match(source, /PROJECT_DIR="\$\(cd "\$SCRIPT_DIR\/\.\." && pwd\)"/);
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
  assert.match(source, /\$HOME_URL\/admin\/dashboard/);
  assert.doesNotMatch(source, /\$HOME_URL\/dashboard/);
  assert.match(source, /trap cleanup/);
  assert.match(source, /AI_HOOK_SKIP_OPEN/);
});

test("Windows launchers resolve the repository root and preserve their entry points", async () => {
  const [labSource, dashboardSource] = await Promise.all([
    readFile(labLauncherUrl, "utf8"),
    readFile(dashboardLauncherUrl, "utf8"),
  ]);

  assert.match(labSource, /cd \/d "%~dp0\.\."/);
  assert.match(labSource, /http:\/\/localhost:3000/);
  assert.match(labSource, /npm run dev/);
  assert.match(dashboardSource, /cd \/d "%~dp0\.\."/);
  assert.match(dashboardSource, /http:\/\/localhost:3001\/admin\/dashboard/);
  assert.doesNotMatch(dashboardSource, /http:\/\/localhost:300[01]\/dashboard/);
  assert.match(dashboardSource, /Start-Sleep -Seconds 3/);
  assert.match(dashboardSource, /npm run dev -- -p 3001/);
});

test("macOS launcher and environment example are safe local artifacts", async () => {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--stage", "--", "tools/start-ai-hook-mac.command"],
      { cwd: fileURLToPath(new URL("../", import.meta.url)) },
    );
    assert.match(stdout, /^100755 /);
  } else {
    await access(launcherUrl, constants.X_OK);
    const mode = (await stat(launcherUrl)).mode;
    assert.notEqual(mode & 0o111, 0);
  }

  const envExample = await readFile(envExampleUrl, "utf8");
  assert.match(envExample, /^DEEPSEEK_API_KEY=$/m);
  assert.match(envExample, /^DATABASE_URL=$/m);
  assert.match(envExample, /^EVAL_INGEST_TOKEN=$/m);
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9]/);
});
