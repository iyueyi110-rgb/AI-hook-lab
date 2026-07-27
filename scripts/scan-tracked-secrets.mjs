import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { findTrackedSecretFindings } from "../lib/secretScan.ts";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const files = [];
const existingTracked = tracked.filter((path) => existsSync(path));
for (const path of existingTracked) {
  const content = readFileSync(path, "utf8");
  if (!content.includes("\0")) files.push({ path, content });
}
const findings = findTrackedSecretFindings(files);
if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`${finding.path}:${finding.line} [${finding.rule}]\n`);
  process.stderr.write(`Tracked secret scan failed with ${findings.length} finding(s); values were not printed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Tracked secret scan passed (${existingTracked.length} tracked files checked; values are never printed).\n`);
}
