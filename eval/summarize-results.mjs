import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
const files = fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir).filter((name) => name.endsWith(".json")) : [];
const summary = {};

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
  const variant = data.promptVariant ?? "unknown";
  const draft = summary[variant] ?? { groups: 0, hooks: 0, modelScoreSum: 0, badcases: 0 };
  draft.groups += 1;
  for (const hook of data.hooks ?? []) {
    draft.hooks += 1;
    draft.modelScoreSum += Number(hook.overallScore ?? hook.score ?? 0);
    draft.badcases += (hook.badcaseTags ?? []).length;
  }
  summary[variant] = draft;
}

console.log("AI Hook paired evaluation summary (model self-scores are not real click performance)");
for (const [variant, value] of Object.entries(summary)) {
  console.log(`${variant}: groups=${value.groups}, hooks=${value.hooks}, model_self_score=${value.hooks ? (value.modelScoreSum / value.hooks).toFixed(2) : "0"}, badcases=${value.badcases}`);
}
console.log("Human scores remain in for-scoring.csv and must be analyzed separately.");
