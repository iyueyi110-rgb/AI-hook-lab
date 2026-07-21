import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { BAD_CASE_TYPES } from "../lib/evaluation/types.ts";

export const DEFAULT_CONTROLLED_TEST_PATH = "docs/evidence/data/controlled-test.csv";

export const CONTROLLED_TEST_COLUMNS = [
  "participant_id",
  "task_id",
  "hook_id",
  "favorited",
  "selected",
  "task_valid",
  "timestamp",
  "prompt_version",
  "bad_case_tags",
  "guardrail_triggered",
  "guardrail_type",
];

export const GUARDRAIL_TYPES = [
  "task_coverage",
  "feedback_response",
  "generation_completion",
  "bad_case_distribution",
];

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const REQUIRED_CONTROLLED_SOURCES = [
  DEFAULT_CONTROLLED_TEST_PATH,
  "scripts/analyze-controlled-test.mjs",
  "docs/evidence/controlled-test-report.md",
];
const CONTROLLED_CLAIM_IDS = [
  "controlled_test_sample",
  "controlled_favorite_rate",
  "controlled_selection_rate",
];

function parseCsvMatrix(input) {
  const text = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error(`CSV 第 ${rows.length + 1} 行包含非法引号`);
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV 包含未闭合的引号");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  while (rows.length > 0 && rows.at(-1).every((value) => value === "")) rows.pop();
  return rows;
}

function parseBoolean(value, rowNumber, column) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`CSV 第 ${rowNumber} 行 ${column} 必须为 true 或 false`);
}

function parseTags(value, allowedValues, rowNumber, column) {
  if (value === "") return [];
  const tags = value.split("|");
  if (new Set(tags).size !== tags.length) {
    throw new Error(`CSV 第 ${rowNumber} 行 ${column} 包含重复值`);
  }
  for (const tag of tags) {
    if (!allowedValues.has(tag)) {
      throw new Error(`CSV 第 ${rowNumber} 行 ${column} 包含不支持的值 ${tag}`);
    }
  }
  return tags;
}

function assertCode(value, rowNumber, column) {
  if (!CODE_PATTERN.test(value)) {
    throw new Error(`CSV 第 ${rowNumber} 行 ${column} 必须为不含个人信息的字母数字编码`);
  }
}

export function parseControlledTestCsv(input) {
  const matrix = parseCsvMatrix(input);
  if (matrix.length === 0) throw new Error("受控测试 CSV 为空");

  const header = matrix[0];
  if (
    header.length !== CONTROLLED_TEST_COLUMNS.length
    || header.some((column, index) => column !== CONTROLLED_TEST_COLUMNS[index])
  ) {
    throw new Error(`CSV 表头必须严格为：${CONTROLLED_TEST_COLUMNS.join(",")}`);
  }
  if (matrix.length === 1) throw new Error("受控测试 CSV 没有数据行");

  const badCaseTypes = new Set(BAD_CASE_TYPES);
  const guardrailTypes = new Set(GUARDRAIL_TYPES);

  return matrix.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== CONTROLLED_TEST_COLUMNS.length) {
      throw new Error(`CSV 第 ${rowNumber} 行字段数不正确`);
    }
    const record = Object.fromEntries(CONTROLLED_TEST_COLUMNS.map((column, columnIndex) => [column, values[columnIndex]]));

    for (const column of ["participant_id", "task_id", "hook_id", "prompt_version"]) {
      assertCode(record[column], rowNumber, column);
    }
    if (!ISO_8601_PATTERN.test(record.timestamp) || Number.isNaN(Date.parse(record.timestamp))) {
      throw new Error(`CSV 第 ${rowNumber} 行 timestamp 必须为带时区的 ISO 8601 时间`);
    }

    const favorited = parseBoolean(record.favorited, rowNumber, "favorited");
    const selected = parseBoolean(record.selected, rowNumber, "selected");
    const taskValid = parseBoolean(record.task_valid, rowNumber, "task_valid");
    const guardrailTriggered = parseBoolean(record.guardrail_triggered, rowNumber, "guardrail_triggered");
    const badCaseTags = parseTags(record.bad_case_tags, badCaseTypes, rowNumber, "bad_case_tags");
    const guardrailTypesForRow = parseTags(record.guardrail_type, guardrailTypes, rowNumber, "guardrail_type");

    if (guardrailTriggered && guardrailTypesForRow.length === 0) {
      throw new Error(`CSV 第 ${rowNumber} 行触发护栏时必须填写 guardrail_type`);
    }
    if (!guardrailTriggered && guardrailTypesForRow.length > 0) {
      throw new Error(`CSV 第 ${rowNumber} 行未触发护栏时 guardrail_type 必须为空`);
    }

    return {
      participantId: record.participant_id,
      taskId: record.task_id,
      hookId: record.hook_id,
      favorited,
      selected,
      taskValid,
      timestamp: record.timestamp,
      promptVersion: record.prompt_version,
      badCaseTags,
      guardrailTriggered,
      guardrailTypes: guardrailTypesForRow,
    };
  });
}

function percentage(numerator, denominator) {
  if (denominator === 0) throw new Error("有效 Hook 分母为 0，不能计算百分比");
  return Math.round(((numerator / denominator) * 100 + Number.EPSILON) * 10) / 10;
}

function countDistinct(records, key) {
  return new Set(records.map((record) => record[key])).size;
}

function summarizeTags(records, key) {
  const counts = new Map();
  for (const record of records) {
    for (const tag of record[key]) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => ({ type, count, percentage: percentage(count, records.length) }));
}

export function analyzeControlledTestRows(records) {
  const hooks = new Set();
  const tasks = new Map();

  for (const record of records) {
    if (hooks.has(record.hookId)) throw new Error(`hook_id 重复：${record.hookId}`);
    hooks.add(record.hookId);

    const task = tasks.get(record.taskId);
    if (!task) {
      tasks.set(record.taskId, {
        participantId: record.participantId,
        promptVersion: record.promptVersion,
        taskValid: record.taskValid,
        selectedCount: record.selected ? 1 : 0,
      });
      continue;
    }
    if (task.participantId !== record.participantId) {
      throw new Error(`同一 task_id 的 participant_id 不一致：${record.taskId}`);
    }
    if (task.promptVersion !== record.promptVersion) {
      throw new Error(`同一 task_id 的 prompt_version 不一致：${record.taskId}`);
    }
    if (task.taskValid !== record.taskValid) {
      throw new Error(`同一 task_id 的 task_valid 不一致：${record.taskId}`);
    }
    if (record.selected) task.selectedCount += 1;
  }

  for (const [taskId, task] of tasks) {
    if (task.taskValid && task.selectedCount > 1) {
      throw new Error(`有效任务最多只能有一个最终首选：${taskId}`);
    }
  }

  const validRecords = records.filter((record) => record.taskValid);
  if (validRecords.length === 0) throw new Error("有效 Hook 分母为 0，不能形成受控测试结论");

  const favoriteCount = validRecords.filter((record) => record.favorited).length;
  const selectionCount = validRecords.filter((record) => record.selected).length;
  const timestamps = records.map((record) => Date.parse(record.timestamp));
  const invalidTaskCount = [...tasks.values()].filter((task) => !task.taskValid).length;

  return {
    total: {
      participants: countDistinct(records, "participantId"),
      tasks: tasks.size,
      hooks: records.length,
    },
    valid: {
      participants: countDistinct(validRecords, "participantId"),
      tasks: countDistinct(validRecords, "taskId"),
      hooks: validRecords.length,
    },
    excluded: {
      tasks: invalidTaskCount,
      hooks: records.length - validRecords.length,
    },
    timeRange: {
      from: new Date(Math.min(...timestamps)).toISOString(),
      to: new Date(Math.max(...timestamps)).toISOString(),
    },
    promptVersions: [...new Set(validRecords.map((record) => record.promptVersion))].sort(),
    favoriteRate: {
      numerator: favoriteCount,
      denominator: validRecords.length,
      percentage: percentage(favoriteCount, validRecords.length),
    },
    selectionRate: {
      numerator: selectionCount,
      denominator: validRecords.length,
      percentage: percentage(selectionCount, validRecords.length),
    },
    badCases: summarizeTags(validRecords, "badCaseTags"),
    guardrails: summarizeTags(validRecords, "guardrailTypes"),
  };
}

export function analyzeControlledTestCsv(input) {
  return analyzeControlledTestRows(parseControlledTestCsv(input));
}

export function expectedControlledMeasurements(analysis) {
  return {
    controlled_test_sample: {
      participants: analysis.total.participants,
      tasks: analysis.total.tasks,
      hooks: analysis.total.hooks,
      validParticipants: analysis.valid.participants,
      validTasks: analysis.valid.tasks,
      validHooks: analysis.valid.hooks,
    },
    controlled_favorite_rate: analysis.favoriteRate,
    controlled_selection_rate: analysis.selectionRate,
  };
}

export function validateControlledEvidenceClaims(claims, analysis) {
  const errors = [];
  const expected = analysis ? expectedControlledMeasurements(analysis) : null;
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));

  for (const claimId of CONTROLLED_CLAIM_IDS) {
    const claim = claimsById.get(claimId);
    if (!claim) {
      errors.push(`Evidence manifest missing claim ${claimId}`);
      continue;
    }
    if (claim.status !== "verified") continue;
    if (!analysis) {
      errors.push(`${claimId}: verified controlled-test claim requires ${DEFAULT_CONTROLLED_TEST_PATH}`);
      continue;
    }
    for (const source of REQUIRED_CONTROLLED_SOURCES) {
      if (!claim.sources?.includes(source)) errors.push(`${claimId}: missing required source ${source}`);
    }
    if (!isDeepStrictEqual(claim.measurement, expected[claimId])) {
      errors.push(`${claimId}: manifest measurement does not match controlled-test CSV`);
    }
  }

  return errors;
}

export async function loadControlledTest(relativePath = DEFAULT_CONTROLLED_TEST_PATH, root = process.cwd()) {
  const input = await readFile(path.resolve(root, relativePath), "utf8");
  return analyzeControlledTestCsv(input);
}

async function runCli() {
  const relativePath = process.argv[2] ?? DEFAULT_CONTROLLED_TEST_PATH;
  try {
    const analysis = await loadControlledTest(relativePath);
    console.log(JSON.stringify({ source: relativePath, ...analysis }, null, 2));
  } catch (error) {
    const message = error?.code === "ENOENT"
      ? `未找到 ${relativePath}；请由产品负责人提供并批准公开脱敏 CSV，Codex 不会生成原始记录。`
      : error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await runCli();
