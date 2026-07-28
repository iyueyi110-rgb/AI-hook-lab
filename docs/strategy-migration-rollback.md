# 策略卡迁移与回滚

## 上线

1. 备份数据库并执行 `db/migrations/002_strategy_governance.sql`。
2. 在预览环境保持 `STRATEGY_CARDS_ENABLED=false`，验证管理员草稿、审核、克隆和版本差异。
3. 完成少量策略的 Live 固定盲评并手动激活。
4. 设置 `STRATEGY_CARDS_ENABLED=true`，验证公开查询、Agent 绑定、反馈和观察性看板。
5. 监测 409、哈希异常、生成完成率和高严重度 Bad Case。

本地开发没有 PostgreSQL 时使用 `data/content-strategies.json`。正式环境必须配置 `DATABASE_URL`，不能依赖 JSON 降级。

## 回滚

先将 `STRATEGY_CARDS_ENABLED=false`。这会停止新策略查询和绑定，不会中断已经持久化 `strategyApplication` 的运行。运营建议和管理员历史仍保留，只读看板继续可审计。

确认没有活动绑定需要完成后，再回滚应用版本。不要在紧急回滚中删除五张治理表；它们保存版本、证据、审核和运行引用。只有经过备份、保留期确认和单独变更审批后，才能执行数据清理。
