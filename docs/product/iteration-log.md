# 迭代记录

## 2026-07-10

- 证据：本地 JSON 在无状态部署中不可作为可靠持久化，且旧看板混淆模型自评分与用户效果。
- 假设：来源隔离、PostgreSQL 事件和成对评测可以提升复盘可信度。
- 实施：新增 PostgreSQL 优先/本地降级存储、`dataOrigin`、模型分与人工分说明、baseline/candidate 和汇总脚本。
- 下一步：补充人工评分样本，按主题难度和平台分层比较，决定是否把 candidate 升为下一版 baseline。
