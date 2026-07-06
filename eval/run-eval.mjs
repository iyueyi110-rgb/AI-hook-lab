import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const DEFAULT_PLATFORMS = ["xiaohongshu", "douyin", "bilibili"];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: undefined,
    platforms: DEFAULT_PLATFORMS,
    delay: 2000,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--limit" && next) {
      options.limit = Number(next);
      i += 1;
    } else if (arg === "--platforms" && next) {
      options.platforms = next.split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--delay" && next) {
      options.delay = Number(next);
      i += 1;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function generate(topic, platform) {
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topic.topic,
      platform,
      contentType: "video",
      targetAudience: topic.targetAudience,
      wordLimit: 80,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

async function main() {
  const options = parseArgs();
  const topics = JSON.parse(fs.readFileSync(path.join(__dirname, "topics.json"), "utf8"));
  const selectedTopics = Number.isFinite(options.limit) ? topics.slice(0, options.limit) : topics;
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const csvRows = [
    [
      "topic",
      "category",
      "difficulty",
      "platform",
      "hook_index",
      "style",
      "text",
      "overallScore",
      "impact",
      "platformFit",
      "actionability",
      "shareability",
      "reasoning",
      "badcaseTags",
      "human_attraction_1_5",
      "human_platform_fit_1_5",
      "human_actionability_1_5",
      "human_adoption_1_5",
      "notes",
    ].join(","),
  ];

  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (const topic of selectedTopics) {
    for (const platform of options.platforms) {
      const label = `[${topic.id}] ${topic.topic} @ ${platform}`;
      process.stdout.write(`${label} ... `);
      try {
        const data = await generate(topic, platform);
        fs.writeFileSync(
          path.join(resultsDir, `${topic.id}-${platform}.json`),
          JSON.stringify(data, null, 2),
          "utf8"
        );

        data.hooks?.forEach((hook, index) => {
          csvRows.push(
            [
              topic.topic,
              topic.category,
              topic.difficulty,
              platform,
              index + 1,
              hook.style,
              hook.text,
              hook.overallScore ?? hook.score,
              hook.scores?.impact,
              hook.scores?.platformFit,
              hook.scores?.actionability,
              hook.scores?.shareability,
              hook.reasoning,
              (hook.badcaseTags ?? []).join(";"),
              "",
              "",
              "",
              "",
              "",
            ].map(csvCell).join(",")
          );
        });

        console.log(`OK (${data.hooks?.length ?? 0} hooks)`);
        successCount += 1;
      } catch (error) {
        console.log(`FAIL (${error.message})`);
        failCount += 1;
      }

      if (options.delay > 0) await sleep(options.delay);
    }
  }

  fs.writeFileSync(path.join(resultsDir, "for-scoring.csv"), `\uFEFF${csvRows.join("\n")}`, "utf8");

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log("\n=== 评测完成 ===");
  console.log(`成功: ${successCount}, 失败: ${failCount}, 耗时: ${elapsed}s`);
  console.log("结果目录: eval/results/");
  console.log("评分 CSV: eval/results/for-scoring.csv");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
