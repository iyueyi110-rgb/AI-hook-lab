# 指标字典

| 指标 | 分子 | 分母 | 来源 |
| --- | --- | --- | --- |
| 生成完成率 | `generation_complete` 数 | `generation_start` 数 | 按 `dataOrigin` 分组 |
| 收藏率 | 净收藏 Hook 数 | 已生成 Hook 数 | 真实操作 |
| 采用率 | 净采用 Hook 数 | 已生成 Hook 数 | 真实操作 |
| 模型自评分 | 每组 `avgScore` 均值 | 完成生成组数 | 模型输出，仅用于排序 |
| 人工平台满意度 | 人工 1–5 分之和 | 人工评分数 | 真实操作或人工评测 |
| Bad Case 分布 | 标签出现次数 | 对应来源候选数 | 评测/真实操作分开 |

所有指标必须同时标注时间范围、Prompt 版本和 `real_operation/evaluation/simulated` 来源。
