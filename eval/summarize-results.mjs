import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(__dirname, "results", "for-scoring.csv");
const DEFAULT_OUTPUT = path.join(__dirname, "results", "summary.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    usableThreshold: 4,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--input" && next) {
      options.input = path.resolve(next);
      i += 1;
    } else if (arg === "--output" && next) {
      options.output = path.resolve(next);
      i += 1;
    } else if (arg === "--usable-threshold" && next) {
      options.usableThreshold = Number(next);
      i += 1;
    }
  }

  return options;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toRecords(rows) {
  const [headers, ...items] = rows;
  return items.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), row[index] ?? ""]))
  );
}

function avg(values) {
  const nums = values
    .filter((value) => String(value ?? "").trim() !== "")
    .map(Number)
    .filter(Number.isFinite);
  return nums.length > 0 ? Math.round((nums.reduce((sum, n) => sum + n, 0) / nums.length) * 10) / 10 : 0;
}

function optionalNumber(value) {
  if (String(value ?? "").trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + amount;
}

function main() {
  const options = parseArgs();
  const raw = fs.readFileSync(options.input, "utf8");
  const records = toRecords(parseCsv(raw));

  const byPlatform = {};
  const badcaseDistribution = {};
  const promptVersionDistribution = {};
  let usableCount = 0;
  let scoredCount = 0;

  for (const record of records) {
    const platform = record.platform || "unknown";
    const templateVersion = record.templateVersion || "unknown";
    byPlatform[platform] ??= {
      hooks: 0,
      avgClickScoreSource: [],
      avgHumanAttractionSource: [],
      usableCount: 0,
      badcaseCount: 0,
    };

    byPlatform[platform].hooks += 1;
    byPlatform[platform].avgClickScoreSource.push(record.clickScore);
    increment(promptVersionDistribution, templateVersion);

    const humanAdoption = optionalNumber(record.human_adoption_1_5);
    if (humanAdoption !== undefined) {
      scoredCount += 1;
      if (humanAdoption >= options.usableThreshold) {
        usableCount += 1;
        byPlatform[platform].usableCount += 1;
      }
    }

    const humanAttraction = optionalNumber(record.human_attraction_1_5);
    if (humanAttraction !== undefined) {
      byPlatform[platform].avgHumanAttractionSource.push(humanAttraction);
    }

    String(record.badcaseTags ?? "")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => {
        increment(badcaseDistribution, tag);
        byPlatform[platform].badcaseCount += 1;
      });
  }

  const platformSummary = Object.fromEntries(
    Object.entries(byPlatform).map(([platform, data]) => [
      platform,
      {
        hooks: data.hooks,
        avgClickScore: avg(data.avgClickScoreSource),
        avgHumanAttraction: avg(data.avgHumanAttractionSource),
        usableRate: scoredCount > 0 ? Math.round((data.usableCount / data.hooks) * 100) : 0,
        badcaseCount: data.badcaseCount,
      },
    ])
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    source: options.input,
    totalHooks: records.length,
    scoredHooks: scoredCount,
    usableRate: scoredCount > 0 ? Math.round((usableCount / scoredCount) * 100) : 0,
    avgClickScore: avg(records.map((record) => record.clickScore)),
    promptVersionDistribution,
    badcaseDistribution,
    platformSummary,
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(summary, null, 2), "utf8");

  console.log("=== 评测汇总 ===");
  console.log(`Hook 总数: ${summary.totalHooks}`);
  console.log(`已人工评分: ${summary.scoredHooks}`);
  console.log(`可用率: ${summary.usableRate}%`);
  console.log(`平均点击欲望: ${summary.avgClickScore}/100`);
  console.log(`输出文件: ${options.output}`);
}

main();
