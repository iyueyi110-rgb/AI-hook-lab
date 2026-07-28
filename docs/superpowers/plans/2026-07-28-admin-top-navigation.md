# 管理工作台顶部导航实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理工具入口移动到共享顶部导航，让 `/admin` 直接成为数据看板首页，并为各层页面提供稳定的上一级返回路径。

**Architecture:** 新增纯配置模块 `lib/adminNavigation.ts` 和客户端显示组件 `AdminWorkspaceHeader`，管理页面仍在服务端完成身份与功能开关校验。数据看板逻辑迁移到 `/admin`，旧 `/admin/dashboard` 只保留兼容重定向；评测页面根据服务端用户角色决定是否显示管理导航。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Phosphor Icons、Node.js 内置测试运行器。

## 全局约束

- `/admin` 必须直接展示数据看板，不再显示四张入口卡片。
- `/admin/dashboard` 必须服务端重定向到 `/admin`。
- 顶部入口顺序固定为数据看板、策略治理、运营 Agent、评测工作台。
- 策略治理和运营 Agent 入口必须遵循现有服务端功能开关；关闭时不显示。
- 数据看板返回 `/`；策略治理、运营 Agent、评测工作台返回 `/admin`。
- 评测批次详情继续先返回 `/evaluation`。
- 非管理员评测用户不得看到管理导航。
- 不修改 API、策略状态机、Agent 状态机、评测数据结构或经典生成逻辑。
- 使用现有瑞士编辑式视觉、现有 CSS 变量和 Phosphor Icons，不新增图片资源。
- 保留 `.playwright-cli/` 与 `output/` 等用户未跟踪目录，不得暂存或删除。

---

## 文件结构

### 新增

- `lib/adminNavigation.ts`：管理入口配置、功能开关过滤和当前路径匹配。
- `lib/adminNavigation.test.ts`：入口顺序、开关和路径匹配单元测试。
- `components/AdminWorkspaceHeader.tsx`：共享管理顶部导航。
- `components/AdminBackLink.tsx`：固定目标的上一级返回按钮。
- `lib/adminNavigationUiContract.test.ts`：共享页头、返回层级和页面接入契约。

### 修改

- `app/admin/page.tsx`：承接数据看板服务端入口。
- `app/admin/dashboard/page.tsx`：改为旧地址兼容重定向。
- `app/admin/dashboard/DashboardClient.tsx`：使用共享管理页头并显示返回创作台。
- `app/admin/dashboard/strategies/page.tsx`：使用管理页头并返回数据看板。
- `app/admin/dashboard/agent/page.tsx`：使用管理页头并返回数据看板。
- `app/evaluation/page.tsx`：仅为管理员构造管理导航配置。
- `app/evaluation/EvaluationClient.tsx`：管理员使用管理页头，其他角色保留通用页头。
- `app/evaluation/runs/[runId]/page.tsx`：仅为管理员批次详情构造管理导航配置。
- `app/evaluation/runs/[runId]/RunDetailClient.tsx`：管理员显示管理页头，返回评测概览行为不变。
- `app/dashboard/page.tsx`：旧公开地址重定向到 `/admin`。
- `lib/adminAccess.ts`：允许登录后安全返回 `/admin` 和策略治理页面。
- `lib/adminAccess.test.ts`：覆盖新增安全返回路径。
- `lib/adminDashboardContract.test.ts`：把数据看板契约迁移到 `/admin`。
- `lib/strategy/route-contract.test.ts`：增加共享管理页头契约。

### 删除

- `lib/adminHub.ts`
- `lib/adminHub.test.ts`
- `lib/adminHubPageContract.test.ts`

---

### Task 1: 管理导航配置与路径匹配

**文件：**
- 新增： `lib/adminNavigation.ts`
- 新增： `lib/adminNavigation.test.ts`

**接口：**
- 产出：
  - `AdminNavigationFlags`
  - `AdminNavigationItem`
  - `getAdminNavigationItems(flags: AdminNavigationFlags): AdminNavigationItem[]`
  - `isAdminNavigationItemCurrent(pathname: string, href: string): boolean`

- [ ] **Step 1: 写入口顺序与开关的失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminNavigationItems,
  isAdminNavigationItemCurrent,
} from "./adminNavigation.ts";

test("admin navigation keeps stable order and hides governed tools when disabled", () => {
  const disabled = getAdminNavigationItems({
    opsAgentEnabled: false,
    strategyCardsEnabled: false,
  });
  assert.deepEqual(
    disabled.map((item) => item.href),
    ["/admin", "/evaluation"],
  );

  const enabled = getAdminNavigationItems({
    opsAgentEnabled: true,
    strategyCardsEnabled: true,
  });
  assert.deepEqual(
    enabled.map((item) => item.href),
    [
      "/admin",
      "/admin/dashboard/strategies",
      "/admin/dashboard/agent",
      "/evaluation",
    ],
  );
});

test("admin navigation highlights exact dashboard and nested tool routes", () => {
  assert.equal(isAdminNavigationItemCurrent("/admin", "/admin"), true);
  assert.equal(
    isAdminNavigationItemCurrent("/admin/dashboard/strategies", "/admin"),
    false,
  );
  assert.equal(
    isAdminNavigationItemCurrent(
      "/admin/dashboard/strategies",
      "/admin/dashboard/strategies",
    ),
    true,
  );
  assert.equal(
    isAdminNavigationItemCurrent("/evaluation/runs/run-1", "/evaluation"),
    true,
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigation.test.ts
```

预期： FAIL，原因是 `lib/adminNavigation.ts` 不存在。

- [ ] **Step 3: 实现最小导航配置**

```ts
export interface AdminNavigationFlags {
  opsAgentEnabled: boolean;
  strategyCardsEnabled: boolean;
}

export interface AdminNavigationItem {
  title: string;
  href: string;
  enabled: boolean;
  match: "exact" | "prefix";
}

export function getAdminNavigationItems(
  flags: AdminNavigationFlags,
): AdminNavigationItem[] {
  return [
    { title: "数据看板", href: "/admin", enabled: true, match: "exact" },
    {
      title: "策略治理",
      href: "/admin/dashboard/strategies",
      enabled: flags.strategyCardsEnabled,
      match: "prefix",
    },
    {
      title: "运营 Agent",
      href: "/admin/dashboard/agent",
      enabled: flags.opsAgentEnabled,
      match: "prefix",
    },
    {
      title: "评测工作台",
      href: "/evaluation",
      enabled: true,
      match: "prefix",
    },
  ].filter((item) => item.enabled);
}

export function isAdminNavigationItemCurrent(
  pathname: string,
  href: string,
): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigation.test.ts
```

预期： 2 tests PASS。

- [ ] **Step 5: 提交**

```powershell
git add -- lib/adminNavigation.ts lib/adminNavigation.test.ts
git commit -m "feat: define admin workspace navigation"
```

---

### Task 2: 共享管理页头与返回按钮

**文件：**
- 新增： `components/AdminWorkspaceHeader.tsx`
- 新增： `components/AdminBackLink.tsx`
- 新增： `lib/adminNavigationUiContract.test.ts`

**接口：**
- 使用：
  - `AdminNavigationFlags`
  - `getAdminNavigationItems()`
  - `isAdminNavigationItemCurrent()`
- 产出：
  - `AdminWorkspaceHeader(props: AdminNavigationFlags)`
  - `AdminBackLink({ href, label }: { href: string; label: string })`

- [ ] **Step 1: 写共享页头的失败契约测试**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("admin workspace header renders governed top navigation with current state", async () => {
  const source = await read("components/AdminWorkspaceHeader.tsx").catch(
    () => "",
  );
  assert.match(source, /getAdminNavigationItems/);
  assert.match(source, /usePathname/);
  assert.match(source, /isAdminNavigationItemCurrent/);
  assert.match(source, /aria-current/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /href="\/"/);
});

test("admin back link uses an explicit destination instead of browser history", async () => {
  const source = await read("components/AdminBackLink.tsx").catch(() => "");
  assert.match(source, /href/);
  assert.match(source, /label/);
  assert.match(source, /ArrowLeft/);
  assert.doesNotMatch(source, /router\.back|history\.back/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigationUiContract.test.ts
```

预期： FAIL，两个组件文件尚不存在。

- [ ] **Step 3: 实现共享管理页头**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Brain,
  ChartBar,
  Flask,
  PencilSimpleLine,
  Strategy,
} from "@phosphor-icons/react";

import {
  getAdminNavigationItems,
  isAdminNavigationItemCurrent,
  type AdminNavigationFlags,
} from "@/lib/adminNavigation";

const icons = {
  "/admin": ChartBar,
  "/admin/dashboard/strategies": Strategy,
  "/admin/dashboard/agent": Brain,
  "/evaluation": Flask,
};

export function AdminWorkspaceHeader(flags: AdminNavigationFlags) {
  const pathname = usePathname();
  const items = getAdminNavigationItems(flags);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color:rgb(245_245_243_/_0.94)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link
          aria-label="AI Hook Lab 创作台"
          className="flex h-16 shrink-0 items-center gap-2.5"
          href="/"
        >
          <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--color-accent)] text-sm font-black text-white">
            H
          </span>
          <span className="hidden text-sm font-black tracking-[-0.02em] sm:block">
            AI HOOK LAB
          </span>
        </Link>
        <Link
          className="hidden h-16 shrink-0 items-center gap-1.5 text-xs font-bold sm:flex"
          href="/"
        >
          <PencilSimpleLine aria-hidden="true" size={17} weight="bold" />
          创作台
        </Link>
        <nav
          aria-label="管理工具"
          className="ml-auto flex h-16 min-w-0 items-stretch gap-1 overflow-x-auto"
        >
          {items.map((item) => {
            const Icon = icons[item.href as keyof typeof icons];
            const current = isAdminNavigationItemCurrent(pathname, item.href);
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-1.5 px-2 text-xs font-bold sm:px-3 ${
                  current
                    ? "text-[var(--color-ink)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[var(--color-accent)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={16} weight="bold" />
                {item.title}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 实现固定目标返回按钮**

```tsx
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      className="inline-flex items-center gap-2 text-xs font-bold text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
      href={href}
    >
      <ArrowLeft aria-hidden="true" size={15} weight="bold" />
      {label}
    </Link>
  );
}
```

- [ ] **Step 5: 运行聚焦测试并确认 GREEN**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigation.test.ts lib/adminNavigationUiContract.test.ts
```

预期： 4 tests PASS。

- [ ] **Step 6: 提交**

```powershell
git add -- components/AdminWorkspaceHeader.tsx components/AdminBackLink.tsx lib/adminNavigationUiContract.test.ts
git commit -m "feat: add shared admin workspace header"
```

---

### Task 3: 将数据看板迁移为 `/admin` 首页

**文件：**
- 修改： `app/admin/page.tsx`
- 修改： `app/admin/dashboard/page.tsx`
- 修改： `app/admin/dashboard/DashboardClient.tsx`
- 修改： `app/dashboard/page.tsx`
- 修改： `lib/adminDashboardContract.test.ts`
- 修改： `lib/adminAccess.ts`
- 修改： `lib/adminAccess.test.ts`
- 删除： `lib/adminHub.ts`
- 删除： `lib/adminHub.test.ts`
- 删除： `lib/adminHubPageContract.test.ts`

**接口：**
- 使用：
  - `AdminWorkspaceHeader`
  - `AdminBackLink`
  - `isStrategyCardsEnabled()`
- 调整 `DashboardClient` 属性，增加 `strategyCardsEnabled: boolean`。

- [ ] **Step 1: 先修改数据看板契约测试**

将 `lib/adminDashboardContract.test.ts` 中读取 `app/admin/dashboard/page.tsx` 的页面级断言改为读取 `app/admin/page.tsx`，并新增：

```ts
test("admin is the canonical dashboard and the legacy route redirects", async () => {
  const adminPage = await source("app/admin/page.tsx");
  const legacyPage = await source("app/admin/dashboard/page.tsx");
  assert.match(adminPage, /getDashboardSummary/);
  assert.match(adminPage, /DashboardClient/);
  assert.match(adminPage, /evaluation\/login\?next=%2Fadmin/);
  assert.match(legacyPage, /permanentRedirect\("\/admin"\)/);
  assert.doesNotMatch(legacyPage, /getDashboardSummary|DashboardClient/);
});

test("dashboard client uses admin navigation and returns to the creative workspace", async () => {
  const client = await source("app/admin/dashboard/DashboardClient.tsx");
  assert.match(client, /AdminWorkspaceHeader/);
  assert.match(client, /strategyCardsEnabled/);
  assert.match(client, /AdminBackLink/);
  assert.match(client, /href="\/"/);
  assert.match(client, /返回创作台/);
});
```

将旧公开地址断言改为：

```ts
assert.match(page, /redirect\("\/admin"\)/);
```

在 `lib/adminAccess.test.ts` 新增：

```ts
assert.equal(sanitizeInternalReturnPath("/admin"), "/admin");
assert.equal(
  sanitizeInternalReturnPath("/admin/dashboard/strategies"),
  "/admin/dashboard/strategies",
);
```

- [ ] **Step 2: 运行测试并确认 RED**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
```

预期： FAIL，因为 `/admin` 仍是卡片页，旧路由仍渲染数据看板。

- [ ] **Step 3: 把数据看板服务端逻辑迁移到 `/admin`**

`app/admin/page.tsx` 使用原数据看板鉴权与读取逻辑，并补充策略开关：

```tsx
import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { DatabaseUnavailablePanel } from "@/components/DatabaseUnavailablePanel";
import {
  classifyAdminAccess,
  isPublicDashboardEnabled,
} from "@/lib/adminAccess";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { getPersistenceMode } from "@/lib/persistence";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
import { DashboardClient } from "./dashboard/DashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板 | AI Hook Lab",
  description: "查看 AI Hook Lab 的生成健康度、内容价值与人工反馈。",
};

export default async function AdminPage() {
  if (getPersistenceMode() === "unavailable") {
    return <DatabaseUnavailablePanel />;
  }
  const publicDashboard = isPublicDashboardEnabled();
  if (!publicDashboard) {
    const access = classifyAdminAccess(await getCurrentEvaluationUser());
    if (access === "unauthenticated") {
      redirect("/evaluation/login?next=%2Fadmin");
    }
    if (access === "forbidden") forbidden();
  }
  return (
    <DashboardClient
      initialSummary={await getDashboardSummary()}
      opsAgentEnabled={isOpsAgentEnabled()}
      publicAccess={publicDashboard}
      strategyCardsEnabled={isStrategyCardsEnabled()}
    />
  );
}
```

- [ ] **Step 4: 将旧管理数据看板改为兼容跳转**

```tsx
import { permanentRedirect } from "next/navigation";

export default function LegacyAdminDashboardPage() {
  permanentRedirect("/admin");
}
```

`app/dashboard/page.tsx` 的目标同步改为：

```tsx
redirect("/admin");
```

- [ ] **Step 5: 让数据看板客户端使用共享页头**

在 `DashboardClient` 的 props 中加入：

```ts
strategyCardsEnabled?: boolean;
```

默认值设为 `false`，并把 `<AppHeader />` 替换为：

```tsx
<AdminWorkspaceHeader
  opsAgentEnabled={!publicAccess && opsAgentEnabled}
  strategyCardsEnabled={!publicAccess && strategyCardsEnabled}
/>
```

在 `<main>` 的页面标题之前加入：

```tsx
<AdminBackLink href="/" label="返回创作台" />
```

公开只读看板继续隐藏所有受保护入口。

- [ ] **Step 6: 更新登录安全返回白名单**

`sanitizeInternalReturnPath()` 的允许路径加入：

```ts
parsed.pathname === "/admin" ||
parsed.pathname === "/admin/dashboard" ||
parsed.pathname === "/admin/dashboard/strategies" ||
parsed.pathname === "/admin/dashboard/agent"
```

- [ ] **Step 7: 删除旧卡片入口配置和测试**

删除：

```text
lib/adminHub.ts
lib/adminHub.test.ts
lib/adminHubPageContract.test.ts
```

确认仓库中不再引用：

```powershell
rg -n "adminHub|getAdminHubItems" app components lib
```

预期： 无输出。

- [ ] **Step 8: 运行聚焦测试并确认 GREEN**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts lib/adminNavigation.test.ts lib/adminNavigationUiContract.test.ts
```

预期： 所有测试 PASS。

- [ ] **Step 9: 提交**

```powershell
git add -- app/admin/page.tsx app/admin/dashboard/page.tsx app/admin/dashboard/DashboardClient.tsx app/dashboard/page.tsx lib/adminAccess.ts lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
git add -u -- lib/adminHub.ts lib/adminHub.test.ts lib/adminHubPageContract.test.ts
git commit -m "feat: make dashboard the admin home"
```

---

### Task 4: 接入策略治理与运营 Agent

**文件：**
- 修改： `app/admin/dashboard/strategies/page.tsx`
- 修改： `app/admin/dashboard/agent/page.tsx`
- 修改： `lib/adminNavigationUiContract.test.ts`
- 修改： `lib/strategy/route-contract.test.ts`

**接口：**
- 使用：
  - `AdminWorkspaceHeader`
  - `AdminBackLink`
  - `isOpsAgentEnabled()`
  - `isStrategyCardsEnabled()`

- [ ] **Step 1: 写两个管理子页面的失败契约测试**

向 `lib/adminNavigationUiContract.test.ts` 增加：

```ts
test("governed admin pages share navigation and return to dashboard", async () => {
  for (const path of [
    "app/admin/dashboard/strategies/page.tsx",
    "app/admin/dashboard/agent/page.tsx",
  ]) {
    const source = await read(path);
    assert.match(source, /AdminWorkspaceHeader/);
    assert.match(source, /AdminBackLink/);
    assert.match(source, /href="\/admin"/);
    assert.match(source, /返回数据看板/);
    assert.doesNotMatch(source, /<AppHeader/);
  }
});
```

- [ ] **Step 2: 运行测试并确认 RED**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigationUiContract.test.ts lib/strategy/route-contract.test.ts
```

预期： FAIL，因为两个页面仍使用 `AppHeader`。

- [ ] **Step 3: 修改策略治理页面**

替换页头导入并补充运营开关：

```tsx
import { AdminBackLink } from "@/components/AdminBackLink";
import { AdminWorkspaceHeader } from "@/components/AdminWorkspaceHeader";
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
```

页面框架改为：

```tsx
<div className="min-h-screen">
  <AdminWorkspaceHeader
    opsAgentEnabled={isOpsAgentEnabled()}
    strategyCardsEnabled
  />
  <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
    <AdminBackLink href="/admin" label="返回数据看板" />
    <header className="mb-6 mt-5 border-b border-[var(--color-line-strong)] pb-6">
```

- [ ] **Step 4: 修改运营 Agent 页面**

替换页头导入并补充策略开关：

```tsx
import { AdminBackLink } from "@/components/AdminBackLink";
import { AdminWorkspaceHeader } from "@/components/AdminWorkspaceHeader";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
```

页面框架改为：

```tsx
<div className="min-h-screen">
  <AdminWorkspaceHeader
    opsAgentEnabled
    strategyCardsEnabled={isStrategyCardsEnabled()}
  />
  <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-20 md:px-6 md:py-8">
    <AdminBackLink href="/admin" label="返回数据看板" />
    <header className="mb-6 mt-5 grid gap-5 border-b border-[var(--color-line-strong)] pb-6 md:grid-cols-[1fr_auto] md:items-end">
```

- [ ] **Step 5: 运行聚焦测试并确认 GREEN**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigationUiContract.test.ts lib/strategy/route-contract.test.ts
```

预期： 所有测试 PASS。

- [ ] **Step 6: 提交**

```powershell
git add -- app/admin/dashboard/strategies/page.tsx app/admin/dashboard/agent/page.tsx lib/adminNavigationUiContract.test.ts lib/strategy/route-contract.test.ts
git commit -m "feat: add navigation to governed admin pages"
```

---

### Task 5: 按角色接入评测工作台

**文件：**
- 修改： `app/evaluation/page.tsx`
- 修改： `app/evaluation/EvaluationClient.tsx`
- 修改： `app/evaluation/runs/[runId]/page.tsx`
- 修改： `app/evaluation/runs/[runId]/RunDetailClient.tsx`
- 修改： `lib/adminNavigationUiContract.test.ts`

**接口：**
- 增加可选客户端属性：

```ts
adminNavigation?: AdminNavigationFlags;
```

- [ ] **Step 1: 写评测角色隔离的失败契约测试**

向 `lib/adminNavigationUiContract.test.ts` 增加：

```ts
test("evaluation shows admin navigation only when server supplies admin flags", async () => {
  const page = await read("app/evaluation/page.tsx");
  const client = await read("app/evaluation/EvaluationClient.tsx");
  const runPage = await read("app/evaluation/runs/[runId]/page.tsx");
  const runClient = await read(
    "app/evaluation/runs/[runId]/RunDetailClient.tsx",
  );

  assert.match(page, /user\.role === "admin"/);
  assert.match(page, /adminNavigation/);
  assert.match(client, /adminNavigation \?/);
  assert.match(client, /AdminWorkspaceHeader/);
  assert.match(client, /返回数据看板/);
  assert.match(runPage, /user\.role === "admin"/);
  assert.match(runClient, /adminNavigation \?/);
  assert.match(runClient, /href="\/evaluation"/);
  assert.match(runClient, /返回评测概览/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigationUiContract.test.ts
```

预期： FAIL，因为评测页面尚未接受管理导航配置。

- [ ] **Step 3: 服务端只为管理员构造导航配置**

在两个评测服务端页面导入：

```ts
import { isOpsAgentEnabled } from "@/lib/agent/ops-http";
import { isStrategyCardsEnabled } from "@/lib/strategy/http";
```

传给客户端：

```tsx
adminNavigation={
  user.role === "admin"
    ? {
        opsAgentEnabled: isOpsAgentEnabled(),
        strategyCardsEnabled: isStrategyCardsEnabled(),
      }
    : undefined
}
```

- [ ] **Step 4: 修改评测概览客户端**

新增 props：

```ts
adminNavigation?: AdminNavigationFlags;
```

页头改为：

```tsx
{adminNavigation ? (
  <AdminWorkspaceHeader {...adminNavigation} />
) : (
  <AppHeader />
)}
<main className="mx-auto w-full max-w-7xl px-4 py-7 pb-20 md:px-6">
  {adminNavigation && (
    <AdminBackLink href="/admin" label="返回数据看板" />
  )}
  <header className={`${adminNavigation ? "mt-5 " : ""}flex flex-col gap-5 border-b border-[var(--color-line-strong)] pb-6 md:flex-row md:items-end md:justify-between`}>
```

删除评测页标题区中重复的“数据看板”按钮，顶部管理导航已承担该入口。

- [ ] **Step 5: 修改评测批次详情客户端**

同样增加可选 `adminNavigation`。管理员使用 `AdminWorkspaceHeader`，其他角色继续使用 `AppHeader`。保留现有：

```tsx
<Link href="/evaluation">
  <ArrowLeft />
  返回评测概览
</Link>
```

不要把批次详情返回目标改为 `/admin`。

- [ ] **Step 6: 运行聚焦测试并确认 GREEN**

运行命令：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminNavigationUiContract.test.ts
```

预期： 所有测试 PASS。

- [ ] **Step 7: 提交**

```powershell
git add -- app/evaluation/page.tsx app/evaluation/EvaluationClient.tsx
git add -- 'app/evaluation/runs/[runId]/page.tsx' 'app/evaluation/runs/[runId]/RunDetailClient.tsx'
git add -- lib/adminNavigationUiContract.test.ts
git commit -m "feat: add role-aware evaluation navigation"
```

---

### Task 6: 完整验证、浏览器检查与发布

**文件：**
- 新增： `design-qa.md`
- 仅在验证发现缺陷时修改其他文件。

**接口：**
- 产出以 `/admin` 为规范数据看板地址的生产部署。

- [ ] **Step 1: 运行全部自动化门禁**

运行命令：

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

预期：

- 所有命令退出码为 0；
- Next.js 路由清单包含 `/admin`；
- 测试无失败、取消或跳过；
- 安全扫描不输出任何密钥值。

- [ ] **Step 2: 启动本地预览**

运行命令：

```powershell
npm run dev -- --hostname 127.0.0.1 --port 4173
```

等待终端显示服务已就绪。不要关闭预览进程，直到浏览器验收完成。

- [ ] **Step 3: 执行浏览器设计验收**

使用真实浏览器检查：

1. 管理员登录后打开 `/admin`，首屏标题为“数据看板”；
2. 顶部出现四个入口，当前“数据看板”具有红色下划线和 `aria-current="page"`；
3. 进入策略治理与运营 Agent，当前项切换，并可返回 `/admin`；
4. 进入评测工作台，管理员看到管理导航，批次详情仍返回 `/evaluation`；
5. 使用非管理员评测账号时不显示管理入口；
6. 以窄屏检查顶部入口可横向滚动且无文字遮挡；
7. 浏览器控制台无运行错误。

在项目根目录创建 `design-qa.md`，记录参考截图、检查视口、发现的问题和：

```md
final result: passed
```

如果存在 P0、P1 或 P2 问题，先修复并重新检查；不得以 `blocked` 或未通过结果进入发布。

- [ ] **Step 4: 提交设计验收结果**

```powershell
git add -- design-qa.md
git commit -m "test: verify admin navigation design"
```

- [ ] **Step 5: 推送并创建 PR**

```powershell
git status -sb
git push -u origin feat/admin-top-navigation
gh pr create --base main --head feat/admin-top-navigation --title "将管理入口移至顶部导航" --body "将 /admin 调整为数据看板首页，增加共享管理顶部导航和稳定的返回层级；评测页面按角色显示管理入口。已完成全量测试、Agent 评测、构建、安全扫描与浏览器设计验收。"
```

预期： 返回新的 GitHub PR 地址。

- [ ] **Step 6: 等待 GitHub 质量检查并合并**

```powershell
gh pr checks --watch --interval 10
gh pr merge --merge
```

预期： `quality` 检查通过，PR 状态为 `MERGED`。

- [ ] **Step 7: 部署 Vercel 生产环境**

```powershell
npx --yes vercel@latest --prod --yes
```

预期：

- `readyState` 为 `READY`；
- `target` 为 `production`；
- 自定义域名别名为 `https://hookovo.icu`。

- [ ] **Step 8: 线上验证**

匿名检查：

```powershell
curl.exe -sS -D - -o NUL https://hookovo.icu/admin
curl.exe -sS -D - -o NUL https://hookovo.icu/admin/dashboard
```

预期：

- `/admin` 在未登录时返回登录跳转，不是 404；
- `/admin/dashboard` 先重定向到 `/admin`；
- 登录后 `/admin` 显示数据看板和顶部管理入口。

- [ ] **Step 9: 更新任务计划并交付**

交付信息必须包含：

- 生产管理地址；
- PR 地址与合并提交；
- Vercel 部署状态；
- 自动化验证计数；
- `/admin` 与旧路径的线上状态。
