# AI Hook Lab 离线评测系统

## 目的与证据边界

离线评测用于比较同一固定输入下 baseline Prompt 与 candidate Prompt 的输出，辅助判断 Prompt 是否值得升级。结论只适用于本评测集，不代表真实点击、收藏、采用或传播效果。

系统严格区分：

| 来源 | `dataOrigin` | 含义 |
| --- | --- | --- |
| 真实用户 | `real_user` | 创作台中的真实生成、收藏、复制和采用操作 |
| 离线评测 | `evaluation_set` | 固定案例、人工评分、收藏/采用意向和 A/B 盲评 |
| 模拟事件 | `simulation` | 产品演示或测试事件 |

Mock 评测使用 `dataOrigin=evaluation_set` 和 `executionMode=mock`。它可以验证完整流程，但报告永远显示“需要继续评测”。模型自评分仅用于候选排序；人工收藏意向和采用意向不会写入真实行为事件。

## 固定案例

数据集 `hook-eval-v1` 由 20 个固定主题和三个平台构成，共 60 条：

- 小红书：60 字，生活化、经验分享、强调情绪价值。
- 抖音：45 字，口语化、直接、结果或冲突前置。
- B站：70 字，问题导向、知识密度和过程分析。

种子位于 `lib/evaluation/seeds.ts`，可读主题清单位于 `eval/topics.json`。官方升级结论要求完整覆盖 60 条；子集运行只能作为 Smoke Test。

## 数据与存储

配置 `DATABASE_URL` 时使用 PostgreSQL，否则降级到忽略版本控制的 `data/evaluation-store.json`。JSON 写入使用进程内串行队列和原子重命名，适合单实例本地使用；多人或正式环境应使用 PostgreSQL。

PostgreSQL 表包括用户、会话、案例、Prompt 版本、批次、候选生成、人工评分、成对盲评、Bad Case 和审计记录。批次保存案例、Prompt、模型参数和 SHA-256 快照，历史 Prompt 内容不可覆盖。

```bash
npm run eval:migrate
npm run eval:seed
```

迁移脚本会把旧来源 `real_operation/evaluation/simulated` 显式转换为 `real_user/evaluation_set/simulation`。本地事件文件修改前会创建带时间戳的备份；未知来源不会回退为真实用户。

## 账号与权限

首次打开 `/evaluation/login` 可创建首个管理员。也可以通过环境变量创建：

```bash
EVAL_USER_PASSWORD='至少十二位密码' npm run eval:user -- create-admin --username admin --display-name 管理员
```

管理员创建其他账号时使用 `admin`、`evaluator` 或 `adjudicator` 角色。密码使用带独立盐的 `scrypt` 哈希；会话只保存随机令牌摘要，HttpOnly Cookie 有效期 12 小时。连续五次登录失败会锁定 15 分钟。

## 一次完整评测

1. 管理员登录 `/evaluation`，创建两名评测员和一名裁决员。
2. 在 Prompt 区查看不可变的 `v1.0 baseline`、`v1.1 candidate`，或创建新的 candidate 版本。
3. 创建批次，选择两个 Prompt、统一模型参数、两名评测员、裁决员和 `live/mock` 模式。
4. 在批次页逐案例执行生成。一次操作处理同一案例的 baseline/candidate，各返回三条，共 120 个生成任务和 360 条候选。
5. 格式错误和接口错误最多尝试三次；终态错误保留证据，管理员显式重新排队。
6. 管理员从每组三条候选中选择一条，形成 120 条正式结果。开始人工评分后不能替换该结果。
7. 两名评测员分别登录，独立完成 120 条匿名评分和 60 次 A/B 盲评；A/B 映射创建批次时随机并持久化。
8. 收藏/采用意向或 A/B 结果冲突时，裁决员在匿名页面完成第三人裁决。
9. 管理员为 Bad Case 填写根因和改进动作，打开报告查看整体、分平台、Bad Case 和七项门槛。
10. 从报告区分别下载五个 CSV、`evaluation_report.json` 和 `evaluation_report.md`。

## 评分与聚合

四个数值维度均为 1–5 分。每条正式结果取两名主要评测者均值：

- 人工可用率：平均可用性分不低于 4 的正式结果数 / 已聚合正式结果数。
- 平台适配率：平均平台适配分不低于 4 的正式结果数 / 已聚合正式结果数。
- 人工收藏/采用意向率：两人一致或裁决后的 `true` 数 / 已聚合正式结果数。
- candidate 胜率：candidate 获胜案例数 / 排除平局后的有效案例数。
- 平局率：平局案例数 / 已定案案例数。
- Bad Case：按“正式结果 + 类型”去重，严重度取最高值。

当 baseline 某类 Bad Case 为 0 而 candidate 大于 0 时，报告显示“新增 N 条”，不计算无穷变化率。

## Prompt 升级门槛

只有完整 60 案例、120 条正式结果全部聚合、60 次 A/B 全部定案、无终态缺失且为 Live 模式时才判定。默认七项门槛为：

1. candidate 人工可用率严格高于 baseline。
2. candidate 平台适配率至少提高 8 个百分点。
3. candidate 非平局胜率严格高于 55%。
4. 高严重度 Bad Case 不增加。
5. 任一平台人工可用率下降不超过 5 个百分点。
6. candidate 首次响应格式错误率不高于 baseline。
7. candidate 正式结果字数超限数不高于 baseline。

全部通过为“建议升级”；完整数据下任一失败为“暂不升级”；数据不完整、子集运行或 Mock 模式为“需要继续评测”。系统不会自动覆盖线上 Prompt。

## Bad Case 类型

固定类型包括：内容过于宽泛、平台语气不匹配、与主题偏离、表达套路化、开头缺乏吸引力、推荐理由空泛、字数超限、候选内容重复、存在事实风险、表达不自然、输出格式错误和其他。

## 验证

```bash
npm test
npm run lint
npm run build
```

无 API Key 时使用 Mock 模式。Live 模式必须配置 `DEEPSEEK_API_KEY`，缺失时批次创建会明确失败，不会自动生成伪造结果。
