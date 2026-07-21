import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  EVALUATION_CASES,
  validateCanonicalCases,
} from "../lib/evaluation/seeds.ts";

const root = process.cwd();
const manifestPath = path.join(root, "docs/evidence/evidence-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedStatuses = new Set(["verified", "method_only", "not_verified"]);
const errors = [];

if (!Array.isArray(manifest.claims) || manifest.claims.length === 0) {
  errors.push("Evidence manifest must contain claims");
}

for (const claim of manifest.claims ?? []) {
  if (!claim.id || !claim.claim || !allowedStatuses.has(claim.status)) {
    errors.push(`Invalid evidence claim: ${JSON.stringify(claim)}`);
    continue;
  }
  if (claim.status === "verified" && (!Array.isArray(claim.sources) || claim.sources.length === 0)) {
    errors.push(`${claim.id}: verified claims require sources`);
  }
  for (const source of claim.sources ?? []) {
    if (typeof source !== "string" || path.isAbsolute(source) || source.includes("..")) {
      errors.push(`${claim.id}: invalid source path ${String(source)}`);
      continue;
    }
    try {
      await access(path.join(root, source));
    } catch {
      errors.push(`${claim.id}: missing source ${source}`);
    }
  }
}

const topics = JSON.parse(await readFile(path.join(root, "eval/topics.json"), "utf8"));
if (!Array.isArray(topics) || topics.length !== 20) {
  errors.push("Public topic inventory must contain exactly 20 topics");
}
errors.push(...validateCanonicalCases(EVALUATION_CASES));

// Evidence audit/status files intentionally retain rejected figures in an
// explicit "not verified" context. Product and portfolio narratives must not
// present those figures as outcomes.
async function collectMarkdownFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }

  return files;
}

const publicNarrativeFiles = [
  "README.md",
  ...(await collectMarkdownFiles("docs/product")),
  ...(await collectMarkdownFiles("docs/portfolio")),
];
const unsupportedPatterns = [
  /5\s*(?:名|人)(?:目标)?创作者?/,
  /25\s*次(?:受控)?任务/,
  /250\s*条\s*Hook/i,
  /28\s*%/,
  /约\s*9\s*%/,
  /20\s*个?百分点/,
  /41\.7\s*个?百分点/,
];
for (const file of publicNarrativeFiles) {
  const content = await readFile(path.join(root, file), "utf8");
  for (const pattern of unsupportedPatterns) {
    if (pattern.test(content)) errors.push(`${file}: contains unsupported public outcome ${pattern}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const verified = manifest.claims.filter((claim) => claim.status === "verified").length;
  const notVerified = manifest.claims.filter((claim) => claim.status === "not_verified").length;
  console.log(`Public evidence verified: ${verified} verified claim(s), ${notVerified} claim(s) withheld.`);
}
