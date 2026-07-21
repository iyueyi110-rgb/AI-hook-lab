import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_TEST_COLUMNS,
  analyzeControlledTestCsv,
  expectedControlledMeasurements,
  parseControlledTestCsv,
  validateControlledEvidenceClaims,
} from "./analyze-controlled-test.mjs";

type TestRow = Record<(typeof CONTROLLED_TEST_COLUMNS)[number], string>;

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    participant_id: "P01",
    task_id: "T01",
    hook_id: "H01",
    favorited: "false",
    selected: "false",
    task_valid: "true",
    timestamp: "2026-07-21T08:00:00+08:00",
    prompt_version: "candidate_v1",
    bad_case_tags: "",
    guardrail_triggered: "false",
    guardrail_type: "",
    ...overrides,
  };
}

function csv(rows: TestRow[]): string {
  return [
    CONTROLLED_TEST_COLUMNS.join(","),
    ...rows.map((item) => CONTROLLED_TEST_COLUMNS.map((column) => item[column]).join(",")),
  ].join("\n");
}

test("analyzes valid rows, excludes invalid tasks, and rounds percentages to one decimal", () => {
  const analysis = analyzeControlledTestCsv(csv([
    row({ hook_id: "H01", favorited: "true", selected: "true", bad_case_tags: "weak_opening|too_broad" }),
    row({ hook_id: "H02", guardrail_triggered: "true", guardrail_type: "bad_case_distribution" }),
    row({ hook_id: "H03" }),
    row({ task_id: "T02", hook_id: "H04", task_valid: "false", favorited: "true", selected: "true" }),
  ]));

  assert.deepEqual(analysis.total, { participants: 1, tasks: 2, hooks: 4 });
  assert.deepEqual(analysis.valid, { participants: 1, tasks: 1, hooks: 3 });
  assert.deepEqual(analysis.excluded, { tasks: 1, hooks: 1 });
  assert.deepEqual(analysis.favoriteRate, { numerator: 1, denominator: 3, percentage: 33.3 });
  assert.deepEqual(analysis.selectionRate, { numerator: 1, denominator: 3, percentage: 33.3 });
  assert.deepEqual(analysis.badCases, [
    { type: "too_broad", count: 1, percentage: 33.3 },
    { type: "weak_opening", count: 1, percentage: 33.3 },
  ]);
  assert.deepEqual(analysis.guardrails, [
    { type: "bad_case_distribution", count: 1, percentage: 33.3 },
  ]);
});

test("rejects duplicate hook ids", () => {
  assert.throws(
    () => analyzeControlledTestCsv(csv([row(), row()])),
    /hook_id 重复/,
  );
});

test("rejects invalid booleans and timestamps", () => {
  assert.throws(() => parseControlledTestCsv(csv([row({ favorited: "yes" })])), /必须为 true 或 false/);
  assert.throws(() => parseControlledTestCsv(csv([row({ timestamp: "2026-07-21" })])), /ISO 8601/);
});

test("rejects inconsistent task fields", () => {
  assert.throws(
    () => analyzeControlledTestCsv(csv([
      row({ hook_id: "H01" }),
      row({ hook_id: "H02", participant_id: "P02" }),
    ])),
    /participant_id 不一致/,
  );
  assert.throws(
    () => analyzeControlledTestCsv(csv([
      row({ hook_id: "H01" }),
      row({ hook_id: "H02", prompt_version: "candidate_v2" }),
    ])),
    /prompt_version 不一致/,
  );
  assert.throws(
    () => analyzeControlledTestCsv(csv([
      row({ hook_id: "H01" }),
      row({ hook_id: "H02", task_valid: "false" }),
    ])),
    /task_valid 不一致/,
  );
});

test("rejects multiple final selections in one valid task", () => {
  assert.throws(
    () => analyzeControlledTestCsv(csv([
      row({ hook_id: "H01", selected: "true" }),
      row({ hook_id: "H02", selected: "true" }),
    ])),
    /最多只能有一个最终首选/,
  );
});

test("rejects unsupported bad-case and guardrail values", () => {
  assert.throws(() => parseControlledTestCsv(csv([row({ bad_case_tags: "invented_tag" })])), /不支持的值/);
  assert.throws(
    () => parseControlledTestCsv(csv([row({ guardrail_triggered: "true", guardrail_type: "invented_guardrail" })])),
    /不支持的值/,
  );
  assert.throws(
    () => parseControlledTestCsv(csv([row({ guardrail_triggered: "true" })])),
    /必须填写 guardrail_type/,
  );
  assert.throws(
    () => parseControlledTestCsv(csv([row({ guardrail_type: "task_coverage" })])),
    /guardrail_type 必须为空/,
  );
});

test("rejects a zero valid-hook denominator", () => {
  assert.throws(
    () => analyzeControlledTestCsv(csv([row({ task_valid: "false" })])),
    /有效 Hook 分母为 0/,
  );
});

test("detects manifest measurements that no longer match the CSV", () => {
  const analysis = analyzeControlledTestCsv(csv([row({ favorited: "true", selected: "true" })]));
  const measurements = expectedControlledMeasurements(analysis);
  const sources = [
    "docs/evidence/data/controlled-test.csv",
    "scripts/analyze-controlled-test.mjs",
    "docs/evidence/controlled-test-report.md",
  ];
  const claims = Object.entries(measurements).map(([id, measurement]) => ({
    id,
    status: "verified",
    sources,
    measurement,
  }));

  assert.deepEqual(validateControlledEvidenceClaims(claims, analysis), []);
  claims[1].measurement = { ...claims[1].measurement, numerator: 0 };
  assert.match(validateControlledEvidenceClaims(claims, analysis).join("\n"), /does not match/);
  claims[1].sources = [];
  assert.match(validateControlledEvidenceClaims(claims, analysis).join("\n"), /missing required source/);
});
