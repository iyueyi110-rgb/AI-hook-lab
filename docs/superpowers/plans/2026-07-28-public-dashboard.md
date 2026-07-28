# Public Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/dashboard` and its read-only summary API accessible without a password when an explicit production environment switch is enabled.

**Architecture:** Add one shared server-side policy function to `lib/adminAccess.ts`. The dashboard page and summary API consult that function before running their existing session and role checks, while all evaluation, Agent, and write paths remain unchanged. The dashboard client receives a public-access flag so protected navigation links are hidden for anonymous viewers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node.js built-in test runner, Vercel

## Global Constraints

- The feature is enabled only when `PUBLIC_DASHBOARD_ENABLED` is exactly `true`.
- The default and every other value preserve existing administrator authentication.
- Only `/admin/dashboard` and `GET /api/dashboard/summary` become public.
- `/evaluation`, `/admin/dashboard/agent`, account APIs, and `POST /api/dashboard/events` retain existing protection and behavior.
- Public mode exposes only the aggregate dashboard data already rendered by the page.
- No new runtime dependencies.

---

### Task 1: Shared Public Dashboard Policy and Read Path

**Files:**
- Modify: `lib/adminAccess.ts:1-10`
- Modify: `lib/adminAccess.test.ts:1-11`
- Modify: `lib/adminDashboardContract.test.ts:7-34`
- Modify: `app/admin/dashboard/page.tsx:5-24`
- Modify: `app/api/dashboard/summary/route.ts:1-24`

**Interfaces:**
- Produces: `isPublicDashboardEnabled(value?: string): boolean`
- Consumes: `process.env.PUBLIC_DASHBOARD_ENABLED`, existing `classifyAdminAccess`, existing session lookup

- [ ] **Step 1: Write failing behavior and contract tests**

Add a dynamic export check to `lib/adminAccess.test.ts` so the missing function produces an assertion failure instead of a module-load error:

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

Extend `lib/adminDashboardContract.test.ts`:

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

Run:

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
```

Expected: FAIL because `isPublicDashboardEnabled` is not exported and neither read path contains `publicDashboard`.

- [ ] **Step 3: Implement the minimal shared policy**

Add to `lib/adminAccess.ts`:

```ts
export function isPublicDashboardEnabled(
  value = process.env.PUBLIC_DASHBOARD_ENABLED,
): boolean {
  return value === "true";
}
```

In `app/admin/dashboard/page.tsx`, import the function and change the access block to:

```ts
const publicDashboard = isPublicDashboardEnabled();
if (!publicDashboard) {
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard");
  if (access === "forbidden") forbidden();
}
```

In `app/api/dashboard/summary/route.ts`, import the function and wrap only the existing session/role block:

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

Run:

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminAccess.test.ts lib/adminDashboardContract.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the read-path change**

```powershell
git add -- lib/adminAccess.ts lib/adminAccess.test.ts lib/adminDashboardContract.test.ts app/admin/dashboard/page.tsx app/api/dashboard/summary/route.ts
git commit -m "feat: allow opt-in public dashboard reads"
```

### Task 2: Public-Mode Navigation and Configuration Documentation

**Files:**
- Modify: `lib/adminDashboardContract.test.ts:7-90`
- Modify: `app/admin/dashboard/page.tsx:19-24`
- Modify: `app/admin/dashboard/DashboardClient.tsx:208-360`
- Modify: `.env.local.example:1-10`
- Modify: `README.md:176-185`

**Interfaces:**
- Produces: `DashboardClient` prop `publicAccess?: boolean`
- Consumes: `publicDashboard` computed by the page in Task 1

- [ ] **Step 1: Write failing public-navigation and configuration tests**

Add to `lib/adminDashboardContract.test.ts`:

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

Run:

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminDashboardContract.test.ts
```

Expected: FAIL because the prop, conditional links, and environment documentation do not yet exist.

- [ ] **Step 3: Pass public mode into the client**

Update the page render:

```tsx
return (
  <DashboardClient
    initialSummary={await getDashboardSummary()}
    opsAgentEnabled={isOpsAgentEnabled()}
    publicAccess={publicDashboard}
  />
);
```

Update the client signature:

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

Wrap the protected links:

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

Add to `.env.local.example`:

```dotenv
PUBLIC_DASHBOARD_ENABLED=false
```

Add to the README environment-variable table:

```md
| `PUBLIC_DASHBOARD_ENABLED` | 否 | 设为 `true` 时仅公开只读数据看板；其他后台、Agent 和写入接口仍需原权限 |
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test --experimental-strip-types --import ./test/register-ts-extension-loader.mjs lib/adminDashboardContract.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the UI and documentation change**

```powershell
git add -- app/admin/dashboard/page.tsx app/admin/dashboard/DashboardClient.tsx lib/adminDashboardContract.test.ts .env.local.example README.md
git commit -m "docs: expose reversible public dashboard mode"
```

### Task 3: Full Verification and Production Deployment

**Files:**
- Verify only: all tracked source and tests
- Deployment configuration: existing Vercel project `hookovo`

**Interfaces:**
- Consumes: production build output and Vercel environment variable
- Produces: live public dashboard at `https://hookovo.icu/admin/dashboard`

- [ ] **Step 1: Run the full automated test suite**

Run:

```powershell
npm test
```

Expected: exit code `0`, all tests PASS.

- [ ] **Step 2: Run static checks**

Run:

```powershell
npm run lint
```

Expected: exit code `0` with no ESLint errors.

- [ ] **Step 3: Build the production application**

Run:

```powershell
npm run build
```

Expected: exit code `0`, Next.js production build completes.

- [ ] **Step 4: Link the existing Vercel project without creating a new project**

Copy the existing project metadata from the validated deployment snapshot into `.vercel/project.json`, preserving:

```json
{"projectId":"prj_dZO4gjy1HzBzgZjizSfIXCynWDo4","orgId":"team_KnCdratGwK8oOQAZW5ZUifjw","projectName":"hookovo"}
```

Confirm with:

```powershell
npx vercel project inspect hookovo
```

Expected: project `hookovo` under the configured team.

- [ ] **Step 5: Set the production-only environment switch**

Run:

```powershell
"true" | npx vercel env add PUBLIC_DASHBOARD_ENABLED production
```

If the variable already exists, remove only that exact production variable and add it again:

```powershell
npx vercel env rm PUBLIC_DASHBOARD_ENABLED production --yes
"true" | npx vercel env add PUBLIC_DASHBOARD_ENABLED production
```

Expected: Vercel confirms the production variable was added.

- [ ] **Step 6: Deploy the verified source to production**

Run:

```powershell
npx vercel deploy --prod --yes
```

Expected: deployment completes and aliases to `hookovo.icu`.

- [ ] **Step 7: Verify the anonymous production read paths**

Run:

```powershell
curl.exe -I --max-time 25 "https://hookovo.icu/admin/dashboard"
curl.exe -I --max-time 25 "https://hookovo.icu/api/dashboard/summary?origin=real_user"
```

Expected: dashboard does not return a `307` login redirect; summary returns `200`.

- [ ] **Step 8: Verify protected routes remain protected**

Run:

```powershell
curl.exe -I --max-time 25 "https://hookovo.icu/evaluation"
curl.exe -I --max-time 25 "https://hookovo.icu/admin/dashboard/agent"
```

Expected: anonymous access redirects to `/evaluation/login` or otherwise returns the existing unauthenticated response.

- [ ] **Step 9: Record the final source state**

Run:

```powershell
git status --short
git log -4 --oneline --decorate
```

Expected: working tree is clean and the design, implementation, and documentation commits are present.
