# 策略卡故障 Runbook

## 创作者看不到策略

检查 `STRATEGY_CARDS_ENABLED=true`、策略状态为 `active`、`expiresAt` 未过期，并确认平台与内容类型为精确匹配。公开查询最多返回 5 张，不使用受众做硬过滤。

## 绑定返回 409

`strategy_not_active`、`strategy_expired` 或 `strategy_scope_mismatch` 表示管理员归档、自然过期或简报范围已变化。前端应刷新策略列表并要求重新选择，不轮询、不创建预绑定锁。

## 哈希不匹配

立即将 `STRATEGY_CARDS_ENABLED` 设为 `false`，阻止新查询与绑定；已绑定运行仍读取不可变版本完成。保存数据库和审计日志副本，核对 `content_strategy_version.content_hash` 与运行的 `appliedGuidanceHash`，不要直接修改历史 payload。

## 证据缺失或激活失败

检查每个 scope 的最新批次是否为 Live、20 主题、40 个成功生成任务、20 个正式结果/角色、20 个 A/B 定案和全部双人评分。较早成功批次不会覆盖更新失败批次。

## 紧急归档

管理员在策略页执行“归档”。先提交的归档会让尚未绑定的请求返回 409；先提交的绑定被视为现有运行，可以按原不可变版本完成。

## 运营转换异常

确认规范运营会话仍在 24 小时有效期内、消息属于当前管理员、建议类型为 `strategy_candidate`、来源 ID 均在该回答中。提取限制为每管理员每小时 10 次、20 秒超时、最多一次修复。
