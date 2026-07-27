import assert from "node:assert/strict";
import test from "node:test";

import { inspectDocumentationText } from "./check-docs-language.mjs";

test("拒绝纯英文一级至三级说明性标题", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: "# Overview\n\n## Product Context\n\n### Release Plan\n",
  });

  assert.equal(issues.length, 3);
  assert.match(issues[0], /纯英文说明性标题/);
});

test("拒绝纯英文说明性段落", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: "This paragraph explains the rollout plan for readers.\n",
  });

  assert.equal(issues.length, 1);
  assert.match(issues[0], /纯英文说明性段落/);
});

test("拒绝列表、引用和表格单元格中的纯英文说明文本", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: [
      "- Release notes are maintained here.",
      "> This paragraph explains rollout details.",
      "| 状态 | Release notes are maintained here. |",
      "| --- | --- |",
    ].join("\n"),
  });

  assert.equal(issues.length, 3);
  assert.match(issues[0], /纯英文说明性文本/);
  assert.match(issues[1], /纯英文说明性文本/);
  assert.match(issues[2], /纯英文说明性文本/);
});

test("普通英文短标题不能作为技术标识放行", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: [
      "| Product Context | Release Plan |",
      "| --- | --- |",
      "- Release Plan",
    ].join("\n"),
  });

  assert.equal(issues.length, 3);
  assert.match(issues[0], /纯英文说明性文本/);
  assert.match(issues[1], /纯英文说明性文本/);
  assert.match(issues[2], /纯英文说明性文本/);
});

test("允许结构化技术标识表格单元格", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: "| API | HTTP Status | NEXT_PUBLIC_AGENT_COACH_ENABLED |\n| --- | --- | --- |\n",
  });

  assert.deepEqual(issues, []);
});

test("拒绝英文首页引用、双语维护承诺和展示型待办", () => {
  const issues = inspectDocumentationText({
    file: "README.md",
    markdown: [
      "请查看 [English](README.en.md)。",
      "本文档将同时维护中文和英文版本。",
      "TODO: add public results",
      "TBD：补充真实数据",
    ].join("\n"),
  });

  assert.equal(issues.length, 4);
  assert.match(issues[0], /README\.en\.md/);
  assert.match(issues[1], /双语维护承诺/);
  assert.match(issues[2], /展示型 TODO\/TBD/);
  assert.match(issues[3], /展示型 TODO\/TBD/);
});

test("忽略 YAML front matter 与代码围栏", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: [
      "---",
      "name: English Product Name",
      "description: English description",
      "---",
      "",
      "# 中文标题",
      "",
      "```bash",
      "# Windows PowerShell",
      "npm run build",
      "TODO: code placeholder",
      "```",
    ].join("\n"),
  });

  assert.deepEqual(issues, []);
});

test("允许技术标识、URL、命令、路径和中英混合产品名称", () => {
  const issues = inspectDocumentationText({
    file: "README.md",
    markdown: [
      "# AI Hook Lab｜创作工作台",
      "",
      "`NEXT_PUBLIC_AGENT_COACH_ENABLED=true`",
      "",
      "<https://example.com/docs>",
      "",
      "`npm run docs:check`",
      "",
      "`docs/evidence/README.md`",
      "",
      "PostgreSQL、DeepSeek API 与 Next.js 保持原有技术标识。",
    ].join("\n"),
  });

  assert.deepEqual(issues, []);
});

test("问题包含文件名与行号，便于命令行定位", () => {
  const issues = inspectDocumentationText({
    file: "docs/example.md",
    markdown: "# 中文标题\n\nRelease notes are maintained here.\n",
  });

  assert.match(issues[0], /^docs\/example\.md:3:/);
});
