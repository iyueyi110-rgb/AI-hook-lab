# 候选级实时数据分析

## 目标与边界

经典生成成功后，服务端自动保存任务和每条候选的匿名元数据。该链路用于验证平台、Prompt 版本、Bad Case、收藏和最终确认之间的关系，不存储原始主题、Hook 文案、推荐理由、图片、参与者身份或自由文本。

数据来源固定为 `real_user`。它表示产品操作事件来源，不自动证明参与者已经通过真实用户研究招募；对外结论仍需要产品负责人核对样本来源。

## 数据粒度

| 对象 | 粒度 | 主键 | 关键字段 |
| --- | --- | --- | --- |
| `hook_generation_task` | 一行一个生成任务 | `task_id` | 平台、内容类型、Prompt 版本、状态、候选数、开始和完成时间 |
| `hook_candidate` | 一行一个候选 | `task_id + hook_id` | 顺序、平台、版本、模型分数、Bad Case |
| `dashboard_event` | 一行一次行为事件 | `id` | 收藏、取消收藏、采用、取消采用、最终使用确认 |
| `hook_candidate_funnel` | 一行一个候选分析事实 | 视图 | 候选字段、当前收藏状态、当前采用状态、最终确认和使用方式 |

“最终确认”只在创作者提交 `direct_use`、`light_edit` 或 `heavy_rewrite` 时为真。收藏、复制、模型推荐和只点击采用按钮均不能单独进入最终确认分子。

## 指标口径

| 指标 | 分子 | 分母 | 分析单位 |
| --- | --- | --- | --- |
| 任务完成率 | `status=completed` 的任务数 | 已开始任务数 | 任务 |
| 收藏率 | 当前 `favorited=true` 的候选数 | 完成任务产生的候选数 | 候选 |
| 采用标记率 | 当前 `adopted=true` 的候选数 | 完成任务产生的候选数 | 候选 |
| 最终确认率 | 至少一个候选 `final_confirmed=true` 的任务数 | 完成任务数 | 任务 |
| Bad Case 任务率 | 至少出现一次对应标签的任务数 | 完成任务数 | 任务 |

候选并非独立样本。同一任务的十个候选共享主题、平台和用户上下文，因此平台和版本比较必须同时报告任务数与候选数。

## 基础 SQL

平台与版本比较：

```sql
SELECT
  platform,
  prompt_version,
  COUNT(DISTINCT task_id) AS tasks,
  COUNT(*) AS candidates,
  COUNT(*) FILTER (WHERE favorited) AS favorites,
  COUNT(DISTINCT task_id) FILTER (WHERE final_confirmed) AS confirmed_tasks
FROM hook_candidate_funnel
WHERE data_origin = 'real_user'
GROUP BY platform, prompt_version
ORDER BY platform, prompt_version;
```

问题类型比较：

```sql
SELECT
  prompt_version,
  badcase_type,
  COUNT(DISTINCT task_id) AS affected_tasks,
  COUNT(*) AS affected_candidates
FROM hook_candidate_funnel
CROSS JOIN LATERAL unnest(badcase_tags) AS badcase_type
WHERE data_origin = 'real_user'
GROUP BY prompt_version, badcase_type
ORDER BY affected_tasks DESC, badcase_type;
```

任务漏斗：

```sql
SELECT
  COUNT(DISTINCT task_id) AS completed_tasks,
  COUNT(*) AS candidates,
  COUNT(*) FILTER (WHERE favorited) AS favorited_candidates,
  COUNT(DISTINCT task_id) FILTER (WHERE final_confirmed) AS confirmed_tasks
FROM hook_candidate_funnel
WHERE task_status = 'completed' AND data_origin = 'real_user';
```

## 运行与回滚

生产部署先执行 `db/migrations/002_candidate_analytics.sql`。应用也会在第一次候选写入前幂等创建同名对象，避免多实例冷启动时缺表。

如需回滚，先停止候选写入，再执行 `db/migrations/002_candidate_analytics.down.sql`。回滚只删除候选表和视图，不删除既有 `dashboard_event`，因此原有看板仍可恢复使用。

启用 `PUBLIC_DASHBOARD_ENABLED=true` 时，候选级聚合漏斗可随只读看板公开查看；逐行 CSV 仍要求管理员身份，避免公开可关联的任务和候选 ID。

## 验收

1. 同一 `task_id` 重试不会产生重复任务或候选。
2. 每个成功任务的候选数与生成响应一致。
3. 取消收藏和取消采用后，视图返回最新状态。
4. 最终确认必须来自已提交的使用方式反馈。
5. 匿名 CSV 不包含主题、Hook 文案、推荐理由、图片、参与者身份或自由文本。
6. 平台和版本结论同时披露任务数、候选数、时间范围和小样本限制。
