# 管理中心入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增受管理员鉴权保护的 `/admin` 管理中心，集中提供数据看板、策略治理、运营 Agent 和评测工作台入口。

**Architecture:** 使用纯函数生成四个入口的稳定配置，并根据策略与运营功能开关标记可用性；Next.js 服务端页面复用现有数据库降级、管理员会话和禁止访问逻辑。入口页只做导航，不读取或复制任何子系统业务数据。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Node.js 内置测试运行器、Tailwind CSS、Vercel

## 全局约束

- `/admin` 始终要求管理员身份，不受 `PUBLIC_DASHBOARD_ENABLED` 影响。
- 未登录用户跳转 `/evaluation/login?next=%2Fadmin`。
- 非管理员使用现有 `forbidden()` 响应。
- 数据库不可用时渲染现有 `DatabaseUnavailablePanel`。
- 运营 Agent 或策略卡开关关闭时显示不可用卡片，不渲染对应链接。
- 不新增 API、角色、Cookie、客户端持久化或运行时依赖。

---

### 任务 1：管理入口配置

**Files:**
- 创建：`lib/adminHub.test.ts`
- 创建：`lib/adminHub.ts`

**Interfaces:**
- Consumes: `isOpsAgentEnabled()` 和 `isStrategyCardsEnabled()` 的布尔结果
- 产出：`getAdminHubItems(flags: AdminHubFlags): AdminHubItem[]`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

test("admin hub exposes four stable entries and disables governed tools by flag", async () => {
  const module = await import("./adminHub.ts").catch(() => undefined);
  assert.ok(module);
  const items = module.getAdminHubItems({
    opsAgentEnabled: false,
    strategyCardsEnabled: false,
  });
  assert.deepEqual(items.map((item) => item.href), [
    "/admin/dashboard",
    "/admin/dashboard/strategies",
    "/admin/dashboard/agent",
    "/evaluation",
  ]);
  assert.deepEqual(items.map((item) => item.enabled), [true, false, false, true]);
});
```

- [ ] **Step 2: Run test to verify it fails**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminHub.test.ts
```

预期：失败，因为尚未定义 `getAdminHubItems`。

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface AdminHubFlags {
  opsAgentEnabled: boolean;
  strategyCardsEnabled: boolean;
}

export interface AdminHubItem {
  title: string;
  description: string;
  href: string;
  enabled: boolean;
}

export function getAdminHubItems(flags: AdminHubFlags): AdminHubItem[] {
  return [
    {
      title: "数据看板",
      description: "查看生成健康度、内容价值、采用与人工反馈。",
      href: "/admin/dashboard",
      enabled: true,
    },
    {
      title: "策略治理",
      description: "审核、评测、激活和归档版本化策略卡。",
      href: "/admin/dashboard/strategies",
      enabled: flags.strategyCardsEnabled,
    },
    {
      title: "运营 Agent",
      description: "基于看板和评测证据进行只读分析。",
      href: "/admin/dashboard/agent",
      enabled: flags.opsAgentEnabled,
    },
    {
      title: "评测工作台",
      description: "执行 Prompt 评测与策略卡固定盲评。",
      href: "/evaluation",
      enabled: true,
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminHub.test.ts
```

预期：一个测试通过且没有失败。

- [ ] **Step 5: Commit**

```powershell
git add lib/adminHub.ts lib/adminHub.test.ts
git commit -m "feat: define admin hub entries"
```

---

### 任务 2：受保护的管理中心页面

**Files:**
- 创建：`lib/adminHubPageContract.test.ts`
- 创建：`app/admin/page.tsx`

**Interfaces:**
- 使用：`getAdminHubItems()`、`classifyAdminAccess()`、`getCurrentEvaluationUser()`、`getPersistenceMode()`、`isOpsAgentEnabled()`、`isStrategyCardsEnabled()`
- 产出：Next.js 路由 `GET /admin`

- [ ] **Step 1: Write the failing contract test**

```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin entry requires authentication and renders the four governed destinations", async () => {
  const source = await readFile(
    new URL("../app/admin/page.tsx", import.meta.url),
    "utf8",
  ).catch(() => "");
  assert.match(source, /classifyAdminAccess/);
  assert.match(source, /evaluation\/login\?next=%2Fadmin/);
  assert.match(source, /DatabaseUnavailablePanel/);
  assert.match(source, /getAdminHubItems/);
  assert.match(source, /item\\.enabled/);
  assert.match(source, /当前未启用/);
});
```

- [ ] **Step 2: Run test to verify it fails**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminHubPageContract.test.ts
```

预期：失败，因为 `app/admin/page.tsx` 尚不存在，读取到的源码为空。

- [ ] **Step 3: Write minimal server page**

按以下内容创建 `app/admin/page.tsx`：

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AppHeader } from "@/components/AppHeader";
import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import { classifyAdminAccess } from "@/lib/adminAccess";
import { getAdminHubItems } from "@/lib/adminHub";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "管理中心 | AI Hook Lab",
  description: "集中进入数据看板、策略治理、运营分析和评测工作台。",
};

export default async function AdminPage() {
  if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin");
  if (access === "forbidden") forbidden();
  const items = getAdminHubItems({
    opsAgentEnabled: isOpsAgentEnabled(),
    strategyCardsEnabled: isStrategyCardsEnabled(),
  });

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 pb-20 md:px-6">
        <header className="border-b border-[var(--color-line-strong)] pb-6">
          <p className="text-xs font-extrabold text-[var(--color-accent)]">仅管理员可见</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">管理中心</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-graphite)]">
            在一个入口管理数据、策略、运营分析与评测流程。
          </p>
        </header>
        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="管理工具">
          {items.map((item) => item.enabled ? (
            <Link className="editorial-panel block p-5 transition hover:-translate-y-0.5" href={item.href} key={item.href}>
              <h2 className="text-lg font-black">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">{item.description}</p>
              <p className="mt-5 text-xs font-extrabold text-[var(--color-accent)]">打开工具 →</p>
            </Link>
          ) : (
            <article className="editorial-panel p-5 opacity-65" key={item.href}>
              <h2 className="text-lg font-black">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-graphite)]">{item.description}</p>
              <p className="mt-5 text-xs font-extrabold text-[var(--color-muted)]">当前未启用</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run focused tests**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminHub.test.ts lib/adminHubPageContract.test.ts
```

预期：两个测试通过且没有失败。

- [ ] **Step 5: Commit**

```powershell
git add app/admin/page.tsx lib/adminHubPageContract.test.ts
git commit -m "fix: add protected admin entry"
```

---

### 任务 3：完整验证与生产发布

**Files:**
- 验证：所有已跟踪源码、测试和文档
- 部署：Vercel 项目 `yueyyue/hookovo`

**Interfaces:**
- 使用：已提交的 `/admin` 路由与现有生产环境
- 产出：可访问的 `https://hookovo.icu/admin`

- [ ] **Step 1: Run all local gates**

运行：

```powershell
npm run docs:check
npm test
npm run eval:agent
npm run lint
npx tsc --noEmit
npm run build
npm run security:scan
git diff --check
```

预期：每条命令的退出码均为 `0`。

- [ ] **Step 2: Push and open pull request**

运行：

```powershell
git push -u origin fix/admin-entry-hub
gh pr create --base main --head fix/admin-entry-hub --title "修复管理中心入口 404" --body "新增受保护的 /admin 管理中心，并集中提供四个后台入口。"
```

预期：GitHub 返回拉取请求地址。

- [ ] **Step 3: Verify checks and merge**

运行：

```powershell
gh pr checks --watch
gh pr merge --merge
```

预期：所有必要检查通过，拉取请求状态变为 `MERGED`。

- [ ] **Step 4: Deploy production**

运行：

```powershell
npx --yes vercel@latest --prod --yes
```

预期：部署状态为 `READY`，别名仍是 `https://hookovo.icu`。

- [ ] **Step 5: Verify the original failure**

运行：

```powershell
curl.exe --noproxy "*" -sS -D - -o NUL https://hookovo.icu/admin
```

预期：匿名访问返回登录重定向，`Location` 为 `/evaluation/login?next=%2Fadmin`，不再返回 `404`。
