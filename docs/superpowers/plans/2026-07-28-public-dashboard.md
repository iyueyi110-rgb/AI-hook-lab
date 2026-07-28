# 公开看板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/dashboard` and its read-only summary API accessible without a password when an explicit production environment switch is enabled.

**Architecture:** Add one shared server-side policy function to `lib/adminAccess.ts`. The dashboard page and summary API consult that function before running their existing session and role checks, while all evaluation, Agent, and write paths remain unchanged. The dashboard client receives a public-access flag so protected navigation links are hidden for anonymous viewers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node.js built-in test runner, Vercel

## 全局约束

- 仅当 `PUBLIC_DASHBOARD_ENABLED` 严格等于 `true` 时启用该功能。
- 默认值及其他所有值都保留现有管理员身份验证。
- 仅公开 `/admin/dashboard` 和 `GET /api/dashboard/summary`。
- `/evaluation`、`/admin/dashboard/agent`、账户 API 与 `POST /api/dashboard/events` 保持现有保护和行为。
- 公开模式只暴露页面已经呈现的聚合看板数据。
- 不新增运行时依赖。

---

### 任务 1：共享公开看板策略与读取路径

**Files:**
- 修改：`lib/adminAccess.ts:1-10`
- 修改：`lib/adminAccess.test.ts:1-11`
- 修改：`lib/adminDashboardContract.test.ts:7-34`
- 修改：`app/admin/dashboard/page.tsx:5-24`
- 修改：`app/api/dashboard/summary/route.ts:1-24`

**Interfaces:**
- 产出：`isPublicDashboardEnabled(value?: string): boolean`
- 使用：`process.env.PUBLIC_DASHBOARD_ENABLED`、现有 `classifyAdminAccess` 与现有会话查询

- [ ] **Step 1: Write failing behavior and contract tests**

在 `lib/adminAccess.test.ts` 中增加动态导出检查，使函数缺失时产生断言失败，而不是模块加载错误：

```ts
test("public dashboard requires the exact true environment value", async () => {
  const accessModule = await import("./adminAccess.ts");
  const policy = Reflect.get(accessModule, "isPublicDashboardEnabled");
  assert.equal(typeof policy, "function");
  assert.equal(policy("true"), true);
  assert.equal(policy("TRUE"), false);
  assert.equal(policy("1"), false);
  assert.equal(policy(""), false);
  assert.equal(policy(undefined), false);
});
```

扩展 `lib/adminDashboardContract.test.ts`：

```ts
test("dashboard page and read API share the public dashboard policy", async () => {
  const page = await source("app/admin/dashboard/page.tsx");
  const route = await source("app/api/dashboard/summary/route.ts");
  for (const entry of [page, route]) {
    assert.match(entry, /isPublicDashboardEnabled/);
    assert.match(entry, /if \(!publicDashboard\)/);
  }
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
```

预期：失败，因为尚未导出 `isPublicDashboardEnabled`，且两个读取路径都不包含 `publicDashboard`。

- [ ] **Step 3: Implement the minimal shared policy**

在 `lib/adminAccess.ts` 中添加：

```ts
export function isPublicDashboardEnabled(
  value = process.env.PUBLIC_DASHBOARD_ENABLED,
): boolean {
  return value === "true";
}
```

在 `app/admin/dashboard/page.tsx` 中导入该函数，并将访问控制块改为：

```ts
const publicDashboard = isPublicDashboardEnabled();
if (!publicDashboard) {
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard");
  if (access === "forbidden") forbidden();
}
```

在 `app/api/dashboard/summary/route.ts` 中导入该函数，并只包裹现有会话与角色检查块：

```ts
const publicDashboard = isPublicDashboardEnabled();
if (!publicDashboard) {
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (access === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
```

预期：所有聚焦测试通过。

- [ ] **Step 5: Commit the read-path change**

```powershell
git add -- lib/adminAccess.ts lib/adminAccess.test.ts lib/adminDashboardContract.test.ts app/admin/dashboard/page.tsx app/api/dashboard/summary/route.ts
git commit -m "feat: allow opt-in public dashboard reads"
```

### 任务 2：公开模式导航与配置文档

**Files:**
- 修改：`lib/adminDashboardContract.test.ts:7-90`
- 修改：`app/admin/dashboard/page.tsx:19-24`
- 修改：`app/admin/dashboard/DashboardClient.tsx:208-360`
- 修改：`.env.local.example:1-10`
- 修改：`README.md:176-185`

**Interfaces:**
- 产出：`DashboardClient` 属性 `publicAccess?: boolean`
- 使用：任务 1 中页面计算得到的 `publicDashboard`

- [ ] **Step 1: Write failing public-navigation and configuration tests**

在 `lib/adminDashboardContract.test.ts` 中添加：

```ts
test("public dashboard hides links to protected internal tools", async () => {
  const page = await source("app/admin/dashboard/page.tsx");
  const client = await source("app/admin/dashboard/DashboardClient.tsx");
  assert.match(page, /publicAccess=\{publicDashboard\}/);
  assert.match(client, /publicAccess = false/);
  assert.match(client, /!publicAccess && opsAgentEnabled/);
  assert.match(client, /!publicAccess && \(\s*<Link[^>]+href="\/evaluation"/s);
});

test("public dashboard switch is documented in environment templates", async () => {
  const template = await source(".env.local.example");
  const readme = await source("README.md");
  assert.match(template, /^PUBLIC_DASHBOARD_ENABLED=false$/m);
  assert.match(readme, /PUBLIC_DASHBOARD_ENABLED/);
  assert.match(readme, /仅公开只读数据看板/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminDashboardContract.test.ts
```

预期：失败，因为属性、条件链接和环境变量文档尚不存在。

- [ ] **Step 3: Pass public mode into the client**

更新页面渲染：

```tsx
return (
  <DashboardClient
    initialSummary={await getDashboardSummary()}
    opsAgentEnabled={isOpsAgentEnabled()}
    publicAccess={publicDashboard}
  />
);
```

更新客户端签名：

```tsx
export function DashboardClient({
  initialSummary,
  opsAgentEnabled = false,
  publicAccess = false,
}: {
  initialSummary?: DashboardSummary;
  opsAgentEnabled?: boolean;
  publicAccess?: boolean;
}) {
```

包裹受保护链接：

```tsx
{!publicAccess && opsAgentEnabled && (
  <Link className="button-primary" href="/admin/dashboard/agent">
    <Brain aria-hidden="true" size={16} weight="bold" />
    运营分析 Agent
  </Link>
)}
{!publicAccess && (
  <Link className="button-secondary" href="/evaluation">
    <Flask aria-hidden="true" size={16} weight="bold" />
    离线评测
  </Link>
)}
```

- [ ] **Step 4: Document the reversible deployment switch**

在 `.env.local.example` 中添加：

```dotenv
PUBLIC_DASHBOARD_ENABLED=false
```

在 README 环境变量表中添加：

```md
| `PUBLIC_DASHBOARD_ENABLED` | 否 | 设为 `true` 时仅公开只读数据看板；其他后台、Agent 和写入接口仍需原权限 |
```

- [ ] **Step 5: Run focused tests and verify GREEN**

运行：

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminDashboardContract.test.ts
```

预期：所有聚焦测试通过。

- [ ] **Step 6: Commit the UI and documentation change**

```powershell
git add -- app/admin/dashboard/page.tsx app/admin/dashboard/DashboardClient.tsx lib/adminDashboardContract.test.ts .env.local.example README.md
git commit -m "docs: expose reversible public dashboard mode"
```

### 任务 3：完整验证与生产部署

**Files:**
- 仅验证：所有已跟踪源码与测试
- 部署配置：现有 Vercel 项目 `hookovo`

**Interfaces:**
- 使用：生产构建产物与 Vercel 环境变量
- 产出：位于 `https://hookovo.icu/admin/dashboard` 的线上公开看板

- [ ] **Step 1: Run the full automated test suite**

运行：

```powershell
npm test
```

预期：退出码为 `0`，所有测试通过。

- [ ] **Step 2: Run static checks**

运行：

```powershell
npm run lint
```

预期：退出码为 `0`，且没有 ESLint 错误。

- [ ] **Step 3: Build the production application**

运行：

```powershell
npm run build
```

预期：退出码为 `0`，Next.js 生产构建完成。

- [ ] **Step 4: Link the existing Vercel project without creating a new project**

将已验证部署快照中的现有项目元数据复制到 `.vercel/project.json`，并保留：

```json
{"projectId":"prj_dZO4gjy1HzBzgZjizSfIXCynWDo4","orgId":"team_KnCdratGwK8oOQAZW5ZUifjw","projectName":"hookovo"}
```

使用以下命令确认：

```powershell
npx vercel project inspect hookovo
```

预期：在已配置团队下显示项目 `hookovo`。

- [ ] **Step 5: Set the production-only environment switch**

运行：

```powershell
"true" | npx vercel env add PUBLIC_DASHBOARD_ENABLED production
```

如果变量已存在，只删除该生产环境变量并重新添加：

```powershell
npx vercel env rm PUBLIC_DASHBOARD_ENABLED production --yes
"true" | npx vercel env add PUBLIC_DASHBOARD_ENABLED production
```

预期：Vercel 确认已添加生产环境变量。

- [ ] **Step 6: Deploy the verified source to production**

运行：

```powershell
npx vercel deploy --prod --yes
```

预期：部署完成并绑定别名 `hookovo.icu`。

- [ ] **Step 7: Verify the anonymous production read paths**

运行：

```powershell
curl.exe -I --max-time 25 "https://hookovo.icu/admin/dashboard"
curl.exe -I --max-time 25 "https://hookovo.icu/api/dashboard/summary?origin=real_user"
```

预期：看板不返回 `307` 登录重定向，摘要接口返回 `200`。

- [ ] **Step 8: Verify protected routes remain protected**

运行：

```powershell
curl.exe -I --max-time 25 "https://hookovo.icu/evaluation"
curl.exe -I --max-time 25 "https://hookovo.icu/admin/dashboard/agent"
```

预期：匿名访问重定向到 `/evaluation/login`，或返回现有的未认证响应。

- [ ] **Step 9: Record the final source state**

运行：

```powershell
git status --short
git log -4 --oneline --decorate
```

预期：工作树干净，并且设计、实现与文档提交均已存在。
