# 受治理策略桥接层

策略卡是运营分析 Agent 与创作 Agent 之间的唯一桥梁。运营 Agent 只读分析并给出带来源的候选建议；服务端重新读取规范会话，通过独立结构化提取生成草稿；管理员审核并批准离线评测；只有精确版本在全部适用范围的最新 20 主题 Live 盲评中通过七项门禁后，管理员才能激活。

策略状态为：

`draft → pending_review → approved_experiment → active → archived`

审核可以从 `pending_review` 进入 `rejected`。提交审核后的内容不可修改，修改必须克隆新版本。`expiresAt` 只在激活时设置为未来 7–90 天，不参与内容哈希，也不自动续期。

## 证据门禁

- simulation、Mock 和未完成评测只属于 `draft_only`。
- 真实用户同范围完成任务不少于 30 且反馈响应率不低于 50%时，最多属于 `review_support`，永远不能单独激活。
- 每个 `scopePair` 必须使用 `strategy-hook-topics-v1` 的 20 个固定主题完成 Live 盲评。
- baseline 与 candidate 使用同一 Prompt、模型和参数；candidate 只增加精确策略版本的结构化指导。
- 最新完整批次必须在激活前 30 天内完成，并同时通过可用率、平台适配、A/B 胜率、高严重度 Bad Case、采用意向、首次格式错误和字数超限七项门禁。

## 安全与数据边界

`validateStrategyContent()` 在转换、编辑、提交、批准、激活和绑定前执行。策略只以 JSON 转义数据块进入生成上下文，不能改变候选数量、输出 Schema、工具权限、安全规则或人工确认。

创作运行只持久化 `strategyCardId`、`strategyCardVersion` 与 `appliedGuidanceHash`。分析事件不记录策略全文、用户自由输入、联系方式或内部 Bad Case 原文。

策略看板只显示观察性绝对值、分子分母和来源。禁止展示“相比无策略提升率”，也不能把用户主动选择产生的信号解释为因果效果。
