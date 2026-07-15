# 评测与模拟方法

`eval/topics.json` 与 `lib/evaluation/seeds.ts` 描述固定的 20 主题 × 3 平台评测集。系统对同一案例分别运行 baseline 与 candidate，每个版本生成三条候选并人工选择一条正式结果。模型自评分仅作为候选排序参考，双人人工评分和 A/B 盲评独立保存。

评测数据标记为 `evaluation_set`，必须使用受控评测接口或 `EVAL_INGEST_TOKEN`；未通过令牌校验的公开事件由服务端标记为 `real_user`。模拟事件标记为 `simulation`。Mock 评测另带 `executionMode=mock`，不得形成升级结论。
