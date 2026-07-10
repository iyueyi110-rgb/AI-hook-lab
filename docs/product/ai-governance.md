# AI 治理

- 输入限制平台、内容类型、长度和敏感信息模式；API Key 只在服务端使用。
- 输出必须是 JSON，Hook 数量、字段、评分范围、字数和 Bad Case 由代码再次校验。
- `overallScore` 是模型自评分，不是点击预测；人工满意度和采用事件单独保存。
- Prompt 以 `templateVersion + promptVariant` 追踪，baseline/candidate 使用同一评测输入。
- 事件 payload 限制 10KB；评测来源需共享令牌；生产持久化使用 PostgreSQL。
- AI 生成代码或 Prompt 修改必须通过测试、lint、构建和人工审查后合并。
