# 受控测试公开数据目录

经产品负责人确认可公开的脱敏逐 Hook 记录应保存为 `controlled-test.csv`。当前仓库不包含该文件；Codex 不会根据简历数字生成或补齐原始记录。

固定表头如下：

```text
participant_id,task_id,hook_id,favorited,selected,task_valid,timestamp,prompt_version,bad_case_tags,guardrail_triggered,guardrail_type
```

- 一行对应一个 Hook；ID 只能使用不含个人信息的字母数字编码。
- 布尔值只接受 `true` 或 `false`，时间必须为带时区的 ISO 8601。
- `bad_case_tags` 使用 `|` 分隔，取值与 `lib/evaluation/types.ts` 的 `BAD_CASE_TYPES` 一致。
- `guardrail_type` 使用 `|` 分隔，可选值为 `task_coverage`、`feedback_response`、`generation_completion`、`bad_case_distribution`。
- 禁止放入姓名、手机号、邮箱、原始敏感主题、未授权文案或自由文本备注。

产品负责人完成脱敏复核后，运行 `npm run evidence:controlled` 可输出计算结果；运行 `npm run evidence:verify` 可检查数据、manifest 与公开叙事是否一致。
