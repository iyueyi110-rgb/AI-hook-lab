import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskId,
  getFeedbackFormError,
  getOrCreateAnonymousCreatorId,
  shouldSampleFeedback,
} from "./creatorFeedback.ts";

test("feedback sampling is stable and stays close to twenty percent", () => {
  assert.equal(shouldSampleFeedback("task-stable"), shouldSampleFeedback("task-stable"));

  const sampled = Array.from({ length: 1_000 }, (_, index) =>
    shouldSampleFeedback(`task-${index}`),
  ).filter(Boolean).length;

  assert.ok(sampled >= 180 && sampled <= 220, `expected about 20%, received ${sampled / 10}%`);
});

test("anonymous creator id is created once and reused from browser storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  let calls = 0;
  const createId = () => `creator-${++calls}`;

  assert.equal(getOrCreateAnonymousCreatorId(storage, createId), "creator-1");
  assert.equal(getOrCreateAnonymousCreatorId(storage, createId), "creator-1");
  assert.equal(calls, 1);
});

test("task ids are created independently for every generation", () => {
  let sequence = 0;
  const createId = () => `task-${++sequence}`;

  assert.equal(createTaskId(createId), "task-1");
  assert.equal(createTaskId(createId), "task-2");
});

test("feedback form requires bounded reasons except for direct use", () => {
  assert.equal(getFeedbackFormError("adoption", "direct_use", [], ""), null);
  assert.equal(
    getFeedbackFormError("adoption", "light_edit", [], ""),
    "请选择至少一个原因",
  );
  assert.equal(
    getFeedbackFormError("explicit_batch_reject", undefined, ["too_generic"], ""),
    null,
  );
  assert.equal(
    getFeedbackFormError(
      "low_satisfaction",
      undefined,
      ["too_generic", "repetitive", "not_relevant", "other"],
      "",
    ),
    "最多选择 3 个原因",
  );
});

test("feedback form blocks personal information and comments over one hundred characters", () => {
  assert.equal(
    getFeedbackFormError("explicit_batch_reject", undefined, ["other"], "联系 test@example.com"),
    "补充说明中不能包含邮箱、手机号或身份证号",
  );
  assert.equal(
    getFeedbackFormError("explicit_batch_reject", undefined, ["other"], "x".repeat(101)),
    "补充说明最多 100 字",
  );
});
