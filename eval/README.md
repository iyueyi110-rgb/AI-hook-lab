# AI Hook Lab 评测说明

## 评测目的

验证结构化 Prompt、四维评分和 bad case 标记是否提升 Hook 的可用性、平台匹配度和可复用性。

## 评测范围

- 20 个主题 × 3 个平台（小红书、抖音、B站）= 60 组生成
- 每组 10 条 Hook，共 600 条候选文案

## 执行方式

1. 启动开发服务：`npm run dev`
2. 运行小样本 smoke test：
   `node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0`
3. 运行完整评测：`node eval/run-eval.mjs`
4. 打开 `eval/results/for-scoring.csv` 做人工评分
5. 汇总自动指标和人工评分：`npm run eval:summary`

## 人工评分维度

| 维度 | 1 分 | 3 分 | 5 分 |
| --- | --- | --- | --- |
| 吸引力 | 不会点击 | 可能停留 | 明显想看 |
| 平台语气 | 完全不匹配 | 部分匹配 | 原生感强 |
| 可操作性 | 不知道后续讲什么 | 大概知道 | 价值预期清晰 |
| 采用意愿 | 需要大改 | 微调能用 | 可直接采用 |

## 指标

- 生成完成率 = 成功生成组数 / 请求组数
- 收藏率 = 收藏 Hook 数 / 生成 Hook 数
- 采用率 = 标记采用 Hook 数 / 生成 Hook 数
- 平台适配满意度 = 用户 1-5 分评分均值
- Bad case 分布 = `too_generic`、`platform_mismatch`、`weak_reasoning`、`too_long`、`clickbait_risk`
- Prompt 版本表现 = 按 `templateVersion` 和 `promptVariant` 对比平均点击欲望、可用率和 bad case

## 迭代方式

先看 Top bad case，再修改 Prompt 约束、示例和输出格式。每轮保留 CSV，比较可用率、平台匹配度和采用意愿变化。
