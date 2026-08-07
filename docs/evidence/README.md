# AI Hook Lab 公开证据索引

> 审计日期：2026-07-21。项目属于个人 Demo 与验证框架，不宣称已产生真实传播效果。

## 30 秒结论

- 已验证：仓库包含 20 个主题、3 个平台组成的 60 个固定评测案例，以及来源隔离、盲评和升级门槛实现。
- 尚未验证：真实用户受控测试的样本规模、任务与产出规模、收藏和选择行为，以及离线评测提升结果；详细状态见[简历主张审计](claims-audit.md)与机器可读清单。
- 使用规则：没有脱敏原始记录、指标口径、计算过程和结论报告的数字，不进入公开简历。

## 证据导航

| 内容 | 状态 | 入口 |
| --- | --- | --- |
| 固定案例库存 | 已验证 | `eval/topics.json`、`lib/evaluation/seeds.ts` |
| 离线评测方法 | 方法已实现 | [离线评测报告](offline-evaluation-report.md) |
| 创作者受控测试 | 分析器已就绪，原始证据待负责人提供 | [受控测试报告](controlled-test-report.md) |
| 真实创作者研究 | 执行材料与空白工作簿已就绪，研究未执行 | [研究执行包](../product/real-user-research-kit.md)、[验证计划](../product/real-user-validation-plan.md) |
| 指标口径 | 已整理 | [证据指标字典](metrics-dictionary.md) |
| 数字审计 | 已完成 | [简历主张审计](claims-audit.md) |
| 贡献边界 | 已公开 | [本人判断与 AI 协作边界](../portfolio/ai-collaboration.md) |
| Demo 验活 | 持续更新 | [Demo 验证记录](../portfolio/demo-verification.md) |
| 产品策略 | 待真实用户验证 | [北极星指标、竞品矩阵与路线图](../product/product-strategy.md) |

机器可读状态见 `evidence-manifest.json`。运行 `npm run evidence:controlled` 可复算经批准公开的受控测试 CSV；运行 `npm run evidence:verify` 可检查数据、manifest、来源与公开叙事是否一致。研究工作簿是空白录入与复算工具，不是机器可读清单中的结果证据；只有完成脱敏、复算和人工审批后，才能新增结果条目。

## 证据等级

1. `verified`：原始记录、口径、计算和结论均可复核。
2. `method_only`：只能证明系统具备方法或功能，不能证明结果已经发生。
3. `not_verified`：缺少必要原始证据，不得作为公开结果。

本目录不提交账号、会话、密码摘要、原始图片、API Key 或包含个人信息的自由文本。
