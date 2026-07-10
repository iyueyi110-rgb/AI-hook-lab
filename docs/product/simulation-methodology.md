# 评测与模拟方法

`eval/topics.json` 是固定小型评测集。脚本对同一主题、平台分别运行 baseline 与 candidate，输出带 `prompt_variant` 的 JSON 和人工评分 CSV。模型自评分列名明确为 `model_self_score`，人工吸引力、平台匹配、可操作性和采用意愿单独填写。

评测数据写入看板时标记 `evaluation`，必须使用 `EVAL_INGEST_TOKEN`；未通过令牌校验的公开事件统一视为 `real_operation`。评测结论只说明该评测集内表现，不外推为真实点击效果。
