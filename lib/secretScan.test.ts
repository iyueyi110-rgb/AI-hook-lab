import assert from "node:assert/strict";
import test from "node:test";

import { findTrackedSecretFindings } from "./secretScan.ts";

test("tracked secret scan identifies provider keys without returning their values", () => {
  const deepseek = ["sk", "0123456789abcdef0123456789abcdef"].join("-");
  const ark = ["ark", "01234567-89ab-cdef-0123-456789abcdef-extra"].join("-");
  const findings = findTrackedSecretFindings([
    { path: "unsafe.env", content: `DEEPSEEK_API_KEY=${deepseek}\nARK_API_KEY=${ark}\n` },
    { path: ".env.local.example", content: "DEEPSEEK_API_KEY=\nARK_API_KEY=\nARK_MODEL_ID=\n" },
    { path: "README.md", content: "DEEPSEEK_API_KEY=your_api_key_here" },
  ]);

  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.path === "unsafe.env" && (finding.line === 1 || finding.line === 2)));
  assert.equal(JSON.stringify(findings).includes(deepseek), false);
  assert.equal(JSON.stringify(findings).includes(ark), false);
});
