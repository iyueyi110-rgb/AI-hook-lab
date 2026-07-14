# AI Hook Lab 评测命令

完整离线评测入口为 `/evaluation`，方法、指标和操作路径见 `docs/evaluation-system.md`。

```bash
npm run eval:migrate
npm run eval:seed
npm run dev
```

旧的 `eval:run` 脚本保留为 API Smoke Test：它对相同主题和平台运行 baseline/candidate，但不替代候选筛选、双人评分和 A/B 盲评，也不会生成正式升级结论。

```bash
node eval/run-eval.mjs --limit 1 --platforms xiaohongshu --delay 0
npm run eval:summarize
```

所有脚本事件使用 `dataOrigin=evaluation_set`。模型自评分只用于候选排序，不代表真实点击效果。
