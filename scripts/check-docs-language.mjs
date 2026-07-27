import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CJK_PATTERN = /[\u3400-\u9fff]/u;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)?/gu;
const FENCE_PATTERN = /^\s*(```|~~~)/u;
const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/u;
const TECHNICAL_LINE_PATTERNS = [
  /^<https?:\/\/\S+>$/u,
  /^https?:\/\/\S+$/u,
  /^`[^`]+`[。.]?$/u,
  /^(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+$/u,
  /^(?:npm|pnpm|yarn|node|npx|git)\s+\S+/u,
  /^(?:\.{0,2}\/|[A-Za-z]:\\)\S+$/u,
];

function withoutInlineTechnicalSyntax(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`[^`]+`/gu, "")
    .replace(/<https?:\/\/[^>]+>/gu, "")
    .trim();
}

function isTechnicalIdentifierLabel(value) {
  const words = value.match(ENGLISH_WORD_PATTERN) ?? [];
  return (
    words.length > 0 &&
    words.length <= 4 &&
    words.every((word) => /^[A-Z][A-Za-z0-9]*$/u.test(word))
  );
}

function isPureEnglishExplanation(value, minimumWords = 3, allowIdentifierLabel = false) {
  const visible = withoutInlineTechnicalSyntax(value);
  if (!visible || CJK_PATTERN.test(visible)) {
    return false;
  }

  if (allowIdentifierLabel && isTechnicalIdentifierLabel(visible)) {
    return false;
  }

  if (TECHNICAL_LINE_PATTERNS.some((pattern) => pattern.test(value.trim()))) {
    return false;
  }

  const words = visible.match(ENGLISH_WORD_PATTERN) ?? [];
  const nonEnglishSyntax = visible.replace(ENGLISH_WORD_PATTERN, "").replace(/[\s\d.,:;!?'"“”‘’()/_&+—–-]/gu, "");
  return words.length >= minimumWords && nonEnglishSyntax.length === 0;
}

function isDisplayTodo(value) {
  const visible = value
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "")
    .replace(/^\s*#{1,6}\s+/u, "")
    .trim();
  return /^(?:TODO|TBD)\b\s*[:：-]?/iu.test(visible);
}

function isBilingualMaintenancePromise(value) {
  return (
    /(?:中英|中文和英文|中文与英文|双语).{0,12}(?:维护|同步|版本)/u.test(value) ||
    /(?:maintain|provide|keep).{0,24}(?:Chinese|English).{0,24}(?:Chinese|English)/iu.test(value)
  );
}

function extractVisibleSegments(line) {
  let visible = line.trim();
  let isContainer = false;

  if (/^>/u.test(visible)) {
    visible = visible.replace(/^(?:>\s*)+/u, "");
    isContainer = true;
  }

  if (/^(?:[-*+]|\d+\.)\s+/u.test(visible)) {
    visible = visible.replace(/^(?:[-*+]|\d+\.)\s+/u, "");
    isContainer = true;
  }

  if (visible.startsWith("|") || visible.endsWith("|")) {
    const cells = visible
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell && !/^:?-{3,}:?$/u.test(cell));
    return cells.map((text) => ({ text, isContainer: true }));
  }

  return visible ? [{ text: visible, isContainer }] : [];
}

export function inspectDocumentationText({ file, markdown }) {
  const issues = [];
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let inFence = false;
  let inFrontMatter = lines[0]?.trim() === "---";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const lineNumber = index + 1;

    if (inFrontMatter) {
      if (index > 0 && trimmed === "---") {
        inFrontMatter = false;
      }
      continue;
    }

    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence || !trimmed) {
      continue;
    }

    if (/README\.en\.md/iu.test(line)) {
      issues.push(`${file}:${lineNumber}: 禁止引用 README.en.md`);
    }

    if (isBilingualMaintenancePromise(line)) {
      issues.push(`${file}:${lineNumber}: 禁止双语维护承诺`);
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      if (isDisplayTodo(heading[2])) {
        issues.push(`${file}:${lineNumber}: 禁止展示型 TODO/TBD`);
        continue;
      }
      if (isPureEnglishExplanation(heading[2], 1)) {
        issues.push(`${file}:${lineNumber}: 禁止纯英文说明性标题`);
      }
      continue;
    }

    for (const segment of extractVisibleSegments(line)) {
      if (isDisplayTodo(segment.text)) {
        issues.push(`${file}:${lineNumber}: 禁止展示型 TODO/TBD`);
        continue;
      }
      if (isPureEnglishExplanation(segment.text, 3, true)) {
        issues.push(
          `${file}:${lineNumber}: 禁止纯英文说明性${segment.isContainer ? "文本" : "段落"}`,
        );
      }
    }
  }

  return issues;
}

function listTrackedMarkdownFiles() {
  return execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "*.md"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
    .split("\0")
    .map((file) => file)
    .filter(Boolean);
}

function run() {
  const issues = listTrackedMarkdownFiles().flatMap((file) =>
    inspectDocumentationText({
      file,
      markdown: readFileSync(resolve(process.cwd(), file), "utf8"),
    }),
  );

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    console.error(`中文文档检查失败：发现 ${issues.length} 个问题。`);
    process.exitCode = 1;
    return;
  }

  console.log(`中文文档检查通过：已检查 ${listTrackedMarkdownFiles().length} 个已跟踪 Markdown 文件。`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
