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

test("tracked secret scan accepts controlled common placeholders without weakening real key detection", () => {
  const placeholders = [
    "your_api_key", "your_api_key_here", "your_ark_api_key", "replace_me", "CHANGE_ME",
    "sk-your-key-here", "ark-your-key-here", "placeholder", "<secret>", "example",
  ];
  const files = placeholders.flatMap((value, index) => [
    { path: `deepseek-${index}.env`, content: `DEEPSEEK_API_KEY=${value}` },
    { path: `ark-${index}.env`, content: `ARK_API_KEY=${value}` },
  ]);
  assert.deepEqual(findTrackedSecretFindings(files), []);

  const realDeepSeek = ["sk", "fedcba9876543210fedcba9876543210"].join("-");
  const realArk = ["ark", "fedcba98-7654-3210-fedc-ba9876543210-live"].join("-");
  const findings = findTrackedSecretFindings([
    { path: "real-deepseek.env", content: `DEEPSEEK_API_KEY=${realDeepSeek}` },
    { path: "real-ark.env", content: `ARK_API_KEY=${realArk}` },
  ]);
  assert.equal(findings.length, 2);
  assert.equal(JSON.stringify(findings).includes(realDeepSeek), false);
  assert.equal(JSON.stringify(findings).includes(realArk), false);
});

test("tracked secret scan normalizes one matching quote pair only and rejects nested or suffixed placeholders", () => {
  assert.deepEqual(findTrackedSecretFindings([
    { path: "quoted.env", content: [
      "DEEPSEEK_API_KEY='your_api_key'",
      "ARK_API_KEY=\"your_ark_api_key\"",
      "DEEPSEEK_API_KEY=<placeholder>",
    ].join("\n") },
  ]), []);

  const realDeepSeek = ["sk", "00112233445566778899aabbccddeeff"].join("-");
  const realArk = ["ark", "00112233-4455-6677-8899-aabbccddeeff-live"].join("-");
  const findings = findTrackedSecretFindings([
    { path: "unsafe.env", content: [
      "DEEPSEEK_API_KEY=\"'your_api_key'\"",
      "ARK_API_KEY=your_ark_api_key_prod",
      `DEEPSEEK_API_KEY='${realDeepSeek}'`,
      `ARK_API_KEY=\"${realArk}\"`,
    ].join("\n") },
  ]);
  assert.equal(findings.length, 4);
  assert.equal(JSON.stringify(findings).includes(realDeepSeek), false);
  assert.equal(JSON.stringify(findings).includes(realArk), false);
});
