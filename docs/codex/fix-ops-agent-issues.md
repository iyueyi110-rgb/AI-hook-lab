# 运营分析 Agent 合并后修复指令

> 范围：安全修复 + 代码质量改进
> 不改 UI / CSS / 业务逻辑

---

## 🚨 CRITICAL：API Key 泄露

### `.env.local.example` 包含真实密钥

**文件：** `.env.local.example` L2, L18-19

当前文件包含真实生产密钥：
```
DEEPSEEK_API_KEY=<secret>
ARK_API_KEY=<secret>
ARK_MODEL_ID=example
```

**必须执行：**

1. 立即在 DeepSeek 和火山引擎 Ark 平台**吊销这些 Key**
2. 生成新 Key 写入 `.env.local`（不提交）
3. `.env.local.example` 恢复为空占位符：

```diff
- DEEPSEEK_API_KEY=<secret>
+ DEEPSEEK_API_KEY=

- ARK_API_KEY=<secret>
+ ARK_API_KEY=

- ARK_MODEL_ID=example
+ ARK_MODEL_ID=
```

4. 清理 Git 历史中的密钥（至少重写最近两个 commit）：

```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env.local.example" \
  --prune-empty -- --all
```

或用 `git rebase -i` 交互式修改。**不清理历史则密钥永久存在于仓库中。**

5. 建议添加 pre-commit hook 扫描密钥：

`.claude/settings.json` 中已有 scan 脚本 `npm run security:scan`，把它加入 `pre-commit` hook。

---

## HIGH

### 1. `ops-provider.ts` — AbortSignal 竞态条件

**文件：** `lib/agent/ops-provider.ts` L51-55

如果调用 `complete()` 时 `input.signal` 已处于 aborted 状态，事件监听器不会触发，定时器泄漏。

```diff
  async complete(input) {
    if (!apiKey) throw new OpsProviderError("missing_key");
+   if (input.signal?.aborted) throw new OpsProviderError("timeout");
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
```

### 2. `lib/agent/ops.test.ts` — `.ts` 扩展名导入

**文件：** `lib/agent/ops.test.ts` L7-L9

```diff
- import { summarizeDashboardEvents } from "../dashboardStore.ts";
- import type { EvaluationState } from "../evaluation/types.ts";
- import type { EvaluationUser } from "../evaluation/types.ts";
+ import { summarizeDashboardEvents } from "../dashboardStore";
+ import type { EvaluationState } from "../evaluation/types";
+ import type { EvaluationUser } from "../evaluation/types";
```

### 3. `app/api/dashboard/summary/route.ts` — 看板 API 缺少时间窗参数

**文件：** `app/api/dashboard/summary/route.ts`

Agent 工具 `getDashboardSummary` 支持 `from`/`to` 时间窗，`dashboardStore` 已支持过滤，但 Dashboard API 未传递这两个参数。需要在 API 路由中新增 `from`/`to` query param 解析并透传给 `getDashboardSummary`。

```ts
// 在现有的 searchParams.get() 区域追加：
const from = searchParams.get("from") || undefined;
const to = searchParams.get("to") || undefined;
if (from && to) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(from) || !/^\d{4}-\d{2}-\d{2}T/.test(to)) {
    return NextResponse.json({ error: "时间参数必须是 RFC 3339 格式" }, { status: 400 });
  }
  if (Date.parse(from) >= Date.parse(to)) {
    return NextResponse.json({ error: "from 必须早于 to" }, { status: 400 });
  }
}
if ((from && !to) || (!from && to)) {
  return NextResponse.json({ error: "from 和 to 必须同时提供" }, { status: 400 });
}

// getDashboardSummary 调用追加参数：
const summary = await getDashboardSummary(requested, { platform, promptVersion, trigger, from, to });
```

### 4. `ops-http.ts` — 脆弱的错误字符串匹配

**文件：** `lib/agent/ops-http.ts` L76

```ts
// 当前：
if (cause instanceof DatabaseNotConfiguredError || (cause instanceof Error && cause.message.includes("生产环境数据库未配置")))

// 应该：定义一个专用错误类
```

**同时在 `ops-repository.ts` L158**中：

```diff
- throw new Error("生产环境数据库未配置");
+ throw new DatabaseNotConfiguredError();
```

然后在 `ops-http.ts` 中仅用 `instanceof DatabaseNotConfiguredError` 匹配，移除字符串匹配。`DatabaseNotConfiguredError` 已在 `../persistence` 中定义，直接引入即可。

---

## MEDIUM

### 5. `ops-tools.ts` — Prompt 差异算法标注

**文件：** `lib/agent/ops-tools.ts` L151-152

当前 `promptDiff` 只检测完全新增/删除的行。这是设计选择而非 bug，但建议在工具描述中明确说明：

```diff
- description: "比较两个 Prompt 的受限文本差异..."
+ description: "比较两个 Prompt 的受限文本差异（仅显示新增/删除行，不检测行内修改）。..."
```

---

## 验收标准

- [ ] `.env.local.example` 中无真实密钥
- [ ] 密钥已在 DeepSeek / Ark 平台吊销并更换
- [ ] Git 历史已清理（`git log -p -- .env.local.example` 不再显示密钥）
- [ ] `npm test` 240 pass / 0 fail
- [ ] `npm run build` 零 TS 错误
- [ ] `npm run security:scan` 不报告新密钥
- [ ] 看板页面可通过 `?from=...&to=...` 传入时间窗
- [ ] `ops-http.ts` 不再用 `error.message.includes()` 做错误匹配
