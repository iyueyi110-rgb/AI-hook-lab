# Protected Admin Dashboard Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the public dashboard to an admin-only backend, persist production analytics and evaluation state in Vercel-managed Neon PostgreSQL, and deploy the protected flow to `hookovo.icu`.

**Architecture:** Reuse the existing database-backed evaluation session as the authorization source, centralize pure admin access and safe-return-path decisions in `lib/adminAccess.ts`, and enforce authorization independently in the Server Component and summary Route Handler. Keep the public event ingestion endpoint write-only, use Neon through the existing `DATABASE_URL` contract, and fail closed in production when persistent storage is absent while preserving JSON fallback for local development.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Node test runner, PostgreSQL via `pg`, Vercel, Neon.

## Global Constraints

- Read the checked-in Next.js 16.2.9 guides under `node_modules/next/dist/docs/` before changing routing or auth behavior; do not rely on older Next.js conventions.
- Preserve the existing uncommitted changes in `app/globals.css`, `components/InputPanel.tsx`, and `lib/visualRedesignContract.test.ts`; edit overlapping assertions narrowly.
- Only the `admin` evaluation role may read dashboard data.
- `POST /api/dashboard/events` remains public and write-only.
- Do not store the full user topic in server analytics events.
- Production must not fall back to Vercel's temporary filesystem when `DATABASE_URL` is missing.
- Local development may continue to use JSON file fallback when `DATABASE_URL` is empty.
- Do not expose `DATABASE_URL`, `DEEPSEEK_API_KEY`, session tokens, or passwords in logs, tests, commits, or chat.
- Do not migrate the single local test event; the cloud database starts empty.
- Keep the current dashboard visual design and its recent-5,000-event summary window.

---

### Task 1: Centralize admin access and safe return paths

**Files:**
- Create: `lib/adminAccess.ts`
- Create: `lib/adminAccess.test.ts`

**Interfaces:**
- Consumes: `EvaluationUser["role"]` from `lib/evaluation/types.ts`.
- Produces: `classifyAdminAccess(user): "unauthenticated" | "forbidden" | "authorized"` and `sanitizeInternalReturnPath(value, fallback?): string` for pages and Route Handlers.

- [ ] **Step 1: Write the failing unit tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { classifyAdminAccess, sanitizeInternalReturnPath } from "./adminAccess.ts";

test("admin access distinguishes missing, non-admin, and admin users", () => {
  assert.equal(classifyAdminAccess(null), "unauthenticated");
  assert.equal(classifyAdminAccess({ role: "evaluator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "adjudicator" }), "forbidden");
  assert.equal(classifyAdminAccess({ role: "admin" }), "authorized");
});

test("return paths only allow internal backend destinations", () => {
  assert.equal(sanitizeInternalReturnPath("/admin/dashboard"), "/admin/dashboard");
  assert.equal(sanitizeInternalReturnPath("/evaluation/runs/abc?tab=report"), "/evaluation/runs/abc?tab=report");
  assert.equal(sanitizeInternalReturnPath("https://evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("//evil.example/steal"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("javascript:alert(1)"), "/evaluation");
  assert.equal(sanitizeInternalReturnPath("/not-an-internal-page"), "/evaluation");
});
```

- [ ] **Step 2: Run the focused tests and confirm the expected failure**

Run: `node --test --experimental-strip-types lib/adminAccess.test.ts`

Expected: FAIL because `lib/adminAccess.ts` does not exist.

- [ ] **Step 3: Implement the pure access helpers**

```ts
import type { EvaluationUser } from "./evaluation/types.ts";

export type AdminAccess = "unauthenticated" | "forbidden" | "authorized";

type RoleOnlyUser = Pick<EvaluationUser, "role">;

export function classifyAdminAccess(user: RoleOnlyUser | null): AdminAccess {
  if (!user) return "unauthenticated";
  return user.role === "admin" ? "authorized" : "forbidden";
}

export function sanitizeInternalReturnPath(
  value: string | string[] | null | undefined,
  fallback = "/evaluation",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  const parsed = new URL(candidate, "https://hookovo.invalid");
  const allowed =
    parsed.pathname === "/admin/dashboard" ||
    parsed.pathname === "/evaluation" ||
    parsed.pathname.startsWith("/evaluation/");
  return allowed ? `${parsed.pathname}${parsed.search}` : fallback;
}
```

- [ ] **Step 4: Run the focused tests and the existing auth tests**

Run: `node --test --experimental-strip-types lib/adminAccess.test.ts lib/evaluation/auth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the access primitives**

```bash
git add lib/adminAccess.ts lib/adminAccess.test.ts
git commit -m "feat: add admin dashboard access policy"
```

---

### Task 2: Move the dashboard behind page and API authorization

**Files:**
- Modify: `next.config.ts`
- Create: `app/forbidden.tsx`
- Create: `app/admin/dashboard/page.tsx`
- Create: `app/admin/dashboard/DashboardClient.tsx`
- Modify: `app/dashboard/page.tsx`
- Delete: `app/dashboard/DashboardClient.tsx`
- Modify: `app/api/dashboard/summary/route.ts`
- Create: `lib/adminDashboardContract.test.ts`
- Modify: `lib/visualRedesignContract.test.ts`

**Interfaces:**
- Consumes: `classifyAdminAccess()` from Task 1, `getCurrentEvaluationUser()`, and `getDashboardSummary(origin?)`.
- Produces: protected `/admin/dashboard`, a 307 compatibility redirect from `/dashboard`, and 401/403/200 behavior from `GET /api/dashboard/summary`.

- [ ] **Step 1: Add failing source-contract tests for the protected route**

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("admin dashboard checks a database session and role at the page", async () => {
  const page = await source("app/admin/dashboard/page.tsx");
  assert.match(page, /getCurrentEvaluationUser/);
  assert.match(page, /classifyAdminAccess/);
  assert.match(page, /redirect\("\/evaluation\/login\?next=%2Fadmin%2Fdashboard"\)/);
  assert.match(page, /forbidden\(\)/);
});

test("dashboard summary API independently returns 401 and 403", async () => {
  const route = await source("app/api/dashboard/summary/route.ts");
  assert.match(route, /status:\s*401/);
  assert.match(route, /status:\s*403/);
  assert.match(route, /getCurrentEvaluationUser/);
});

test("legacy dashboard redirects and no longer renders data", async () => {
  const page = await source("app/dashboard/page.tsx");
  assert.match(page, /redirect\("\/admin\/dashboard"\)/);
  assert.doesNotMatch(page, /getDashboardSummary/);
});
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run: `node --test --experimental-strip-types lib/adminDashboardContract.test.ts`

Expected: FAIL because `app/admin/dashboard/page.tsx` does not exist.

- [ ] **Step 3: Enable Next.js 16 authorization interrupts and add the 403 UI**

Update `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
```

Create `app/forbidden.tsx`:

```tsx
import Link from "next/link";
import { ShieldWarning } from "@phosphor-icons/react/dist/ssr";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="editorial-panel w-full max-w-md p-6 text-center">
        <ShieldWarning className="mx-auto text-[var(--color-accent)]" size={30} weight="bold" />
        <h1 className="mt-4 text-2xl font-black">没有后台访问权限</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">只有管理员账号可以查看数据看板。</p>
        <Link className="button-secondary mt-5" href="/evaluation">返回评测工作区</Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Move the client component and implement the protected Server Component**

Move the current `app/dashboard/DashboardClient.tsx` unchanged to `app/admin/dashboard/DashboardClient.tsx`, then create `app/admin/dashboard/page.tsx`:

```tsx
import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";

import { classifyAdminAccess } from "@/lib/adminAccess";
import { getDashboardSummary } from "@/lib/dashboardStore";
import { getCurrentEvaluationUser } from "@/lib/evaluation/server";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据看板 | AI Hook Lab",
  description: "查看 AI Hook Lab 的生成健康度、内容价值与人工反馈。",
};

export default async function AdminDashboardPage() {
  const access = classifyAdminAccess(await getCurrentEvaluationUser());
  if (access === "unauthenticated") redirect("/evaluation/login?next=%2Fadmin%2Fdashboard");
  if (access === "forbidden") forbidden();
  return <DashboardClient initialSummary={await getDashboardSummary()} />;
}
```

Replace `app/dashboard/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function LegacyDashboardPage() {
  redirect("/admin/dashboard");
}
```

- [ ] **Step 5: Enforce the same policy in the summary Route Handler**

Place this authorization check before parsing the requested origin:

```ts
const access = classifyAdminAccess(await getCurrentEvaluationUser());
if (access === "unauthenticated") {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
if (access === "forbidden") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Import `classifyAdminAccess` and `getCurrentEvaluationUser`; leave canonical-origin validation and summary generation after the check.

- [ ] **Step 6: Update the visual contract to read the moved dashboard**

Change all `source("app/dashboard/DashboardClient.tsx")` calls in `lib/visualRedesignContract.test.ts` to `source("app/admin/dashboard/DashboardClient.tsx")`. Do not remove the existing pressed-state assertions for `InputPanel` and `globals.css`.

- [ ] **Step 7: Run the focused tests and build**

Run: `node --test --experimental-strip-types lib/adminAccess.test.ts lib/adminDashboardContract.test.ts lib/visualRedesignContract.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: Next.js 16.2.9 build succeeds with `/admin/dashboard` dynamic, `/dashboard` present as a redirecting page, and `/api/dashboard/summary` dynamic.

- [ ] **Step 8: Commit protected dashboard routing**

```bash
git add next.config.ts app/forbidden.tsx app/admin/dashboard app/dashboard/page.tsx app/api/dashboard/summary/route.ts lib/adminDashboardContract.test.ts lib/visualRedesignContract.test.ts
git add -u app/dashboard/DashboardClient.tsx
git commit -m "feat: protect admin data dashboard"
```

---

### Task 3: Return administrators safely to the requested backend page

**Files:**
- Modify: `app/evaluation/login/page.tsx`
- Modify: `app/evaluation/login/EvaluationLoginClient.tsx`
- Modify: `app/api/evaluation/auth/login/route.ts`
- Modify: `app/api/evaluation/setup/route.ts`
- Modify: `lib/adminDashboardContract.test.ts`

**Interfaces:**
- Consumes: `sanitizeInternalReturnPath()` from Task 1.
- Produces: `EvaluationLoginClient({ setupRequired, nextPath })` and safe form/JSON navigation back to `/admin/dashboard` or an evaluation page.

- [ ] **Step 1: Add failing contract assertions for safe login return flow**

Append tests that require:

```ts
test("evaluation login sanitizes next on the server and passes it to the client", async () => {
  const page = await source("app/evaluation/login/page.tsx");
  const client = await source("app/evaluation/login/EvaluationLoginClient.tsx");
  assert.match(page, /sanitizeInternalReturnPath/);
  assert.match(page, /searchParams:\s*Promise/);
  assert.match(client, /nextPath:\s*string/);
  assert.match(client, /router\.replace\(nextPath\)/);
});
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run: `node --test --experimental-strip-types lib/adminDashboardContract.test.ts`

Expected: FAIL because the login page does not consume `searchParams`.

- [ ] **Step 3: Sanitize `next` in the Server Component**

Change the login page signature and setup:

```tsx
export default async function EvaluationLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeInternalReturnPath(params.next);
  const current = await getCurrentEvaluationUser();
  if (current) redirect(current.role === "admin" ? nextPath : "/evaluation");
  const state = await getEvaluationService().getState();
  return <EvaluationLoginClient nextPath={nextPath} setupRequired={state.users.length === 0} />;
}
```

- [ ] **Step 4: Use the sanitized target in client-side login and form fallback**

Update the component interface and endpoint:

```tsx
export function EvaluationLoginClient({
  setupRequired,
  nextPath,
}: {
  setupRequired: boolean;
  nextPath: string;
}) {
  const endpoint = setupRequired ? "/api/evaluation/setup" : "/api/evaluation/auth/login";
  const action = `${endpoint}?next=${encodeURIComponent(nextPath)}`;
```

Keep the component's existing router/loading/error declarations immediately after these constants. Replace the current hard-coded fetch URL and form action with `action`. After a successful JSON response, replace `router.push("/evaluation")` with `router.replace(nextPath)`, followed by the existing `router.refresh()`.

- [ ] **Step 5: Secure form fallback redirects in both auth Route Handlers**

At the start of each POST handler compute:

```ts
const nextPath = sanitizeInternalReturnPath(new URL(request.url).searchParams.get("next"));
```

For successful form submissions use `NextResponse.redirect(new URL(nextPath, request.url), 303)`. For failed forms, build `/evaluation/login?error=login_failed&next=${encodeURIComponent(nextPath)}` (or `setup_failed`) and redirect to that internal URL. JSON responses remain unchanged.

- [ ] **Step 6: Run focused tests and lint the touched files**

Run: `node --test --experimental-strip-types lib/adminAccess.test.ts lib/adminDashboardContract.test.ts`

Expected: PASS.

Run: `npx eslint app/evaluation/login/page.tsx app/evaluation/login/EvaluationLoginClient.tsx app/api/evaluation/auth/login/route.ts app/api/evaluation/setup/route.ts lib/adminAccess.ts`

Expected: no errors.

- [ ] **Step 7: Commit safe login return behavior**

```bash
git add app/evaluation/login/page.tsx app/evaluation/login/EvaluationLoginClient.tsx app/api/evaluation/auth/login/route.ts app/api/evaluation/setup/route.ts lib/adminDashboardContract.test.ts
git commit -m "feat: return admins safely after login"
```

---

### Task 4: Fail closed without production PostgreSQL and minimize analytics data

**Files:**
- Create: `lib/persistence.ts`
- Create: `lib/persistence.test.ts`
- Modify: `lib/dashboardStore.ts`
- Modify: `lib/evaluation/repository.ts`
- Modify: `app/api/dashboard/events/route.ts`
- Modify: `app/api/dashboard/summary/route.ts`
- Create: `components/DatabaseUnavailablePanel.tsx`
- Modify: `app/evaluation/login/page.tsx`
- Modify: `app/admin/dashboard/page.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/adminDashboardContract.test.ts`

**Interfaces:**
- Produces: `getPersistenceMode(env?)`, `getConfiguredDatabaseUrl(env?)`, `assertProductionDatabaseConfigured(env?)`, `DatabaseNotConfiguredError`, and `isDatabaseNotConfiguredError(error)`.
- Consumes: the existing `DATABASE_URL`, `NODE_ENV`, and `VERCEL_ENV` environment contract.

- [ ] **Step 1: Write failing persistence-policy tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionDatabaseConfigured,
  DatabaseNotConfiguredError,
  getConfiguredDatabaseUrl,
  getPersistenceMode,
} from "./persistence.ts";

test("development without a URL keeps JSON fallback", () => {
  assert.equal(getPersistenceMode({ NODE_ENV: "development" }), "json");
});

test("a configured URL selects postgres without exposing it", () => {
  const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://secret" };
  assert.equal(getPersistenceMode(env), "postgres");
  assert.equal(getConfiguredDatabaseUrl(env), "postgresql://secret");
});

test("production without a URL fails closed", () => {
  assert.equal(getPersistenceMode({ NODE_ENV: "production" }), "unavailable");
  assert.throws(
    () => assertProductionDatabaseConfigured({ VERCEL_ENV: "production" }),
    DatabaseNotConfiguredError,
  );
});
```

- [ ] **Step 2: Run the persistence test and confirm it fails**

Run: `node --test --experimental-strip-types lib/persistence.test.ts`

Expected: FAIL because `lib/persistence.ts` does not exist.

- [ ] **Step 3: Implement the environment policy**

```ts
export type PersistenceMode = "postgres" | "json" | "unavailable";
type PersistenceEnvironment = Partial<Pick<NodeJS.ProcessEnv, "DATABASE_URL" | "NODE_ENV" | "VERCEL_ENV">>;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("生产环境数据库未配置，请连接 Neon PostgreSQL 后重试");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getConfiguredDatabaseUrl(env: PersistenceEnvironment = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || undefined;
}

export function getPersistenceMode(env: PersistenceEnvironment = process.env): PersistenceMode {
  if (getConfiguredDatabaseUrl(env)) return "postgres";
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return "unavailable";
  return "json";
}

export function assertProductionDatabaseConfigured(env: PersistenceEnvironment = process.env): void {
  if (getPersistenceMode(env) === "unavailable") throw new DatabaseNotConfiguredError();
}

export function isDatabaseNotConfiguredError(error: unknown): error is DatabaseNotConfiguredError {
  return error instanceof DatabaseNotConfiguredError;
}
```

- [ ] **Step 4: Apply the policy to both repositories without throwing at module import**

In `lib/dashboardStore.ts`, construct the pool only when `getConfiguredDatabaseUrl()` returns a value. Call `assertProductionDatabaseConfigured()` at the start of `readDashboardEvents()` and `appendDashboardEvent()` so `next build` can import the module without a production database while runtime reads/writes fail clearly.

In `getEvaluationRepository()`, switch on `getPersistenceMode()`:

```ts
const mode = getPersistenceMode();
if (mode === "unavailable") throw new DatabaseNotConfiguredError();
singleton = mode === "postgres"
  ? new PostgresEvaluationRepository(getConfiguredDatabaseUrl()!)
  : new JsonEvaluationRepository(process.env.EVALUATION_STORE_PATH || undefined);
```

- [ ] **Step 5: Return 503 for missing production persistence**

In the event and summary Route Handlers, map `DatabaseNotConfiguredError` to:

```ts
return NextResponse.json(
  { ok: false, error: "数据库未配置", message: error.message },
  { status: 503 },
);
```

Preserve 400 for invalid event bodies and unsupported origins. In the summary route, keep 401/403 checks before attempting the dashboard read.

- [ ] **Step 6: Show a clear database configuration panel on internal pages**

Create `components/DatabaseUnavailablePanel.tsx`:

```tsx
export function DatabaseUnavailablePanel() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <section className="editorial-panel w-full max-w-lg p-6 text-center">
        <p className="text-xs font-black text-[var(--color-accent)]">AI HOOK LAB 后台</p>
        <h1 className="mt-3 text-2xl font-black">生产数据库未配置</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          请先在 Vercel 为 hookovo 项目连接 Neon PostgreSQL，再重新部署。
        </p>
        <a
          className="button-primary mt-5"
          href="https://vercel.com/yueyyue/hookovo/stores"
          rel="noreferrer"
          target="_blank"
        >
          打开 Vercel Storage
        </a>
      </section>
    </main>
  );
}
```

In both `app/evaluation/login/page.tsx` and `app/admin/dashboard/page.tsx`, place this check before any session or repository access:

```tsx
if (getPersistenceMode() === "unavailable") return <DatabaseUnavailablePanel />;
```

This ordering is required because the shared session itself is stored in the same unavailable database. Route Handlers still return 401/403 whenever a session decision can be made and map database configuration failures to 503.

- [ ] **Step 7: Stop sending raw topics to analytics**

Change:

```ts
track("generation_start", { topic: topic.trim(), platform, contentType });
```

to:

```ts
track("generation_start", { platform, contentType });
```

Add a source-contract assertion that `app/page.tsx` does not match `/generation_start[^\n]+topic/`.

- [ ] **Step 8: Run persistence, dashboard, and analytics tests**

Run: `node --test --experimental-strip-types lib/persistence.test.ts lib/dashboardStore.test.ts lib/adminDashboardContract.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all existing and new Node tests pass.

- [ ] **Step 9: Commit persistence safety and data minimization**

```bash
git add lib/persistence.ts lib/persistence.test.ts lib/dashboardStore.ts lib/evaluation/repository.ts app/api/dashboard/events/route.ts app/api/dashboard/summary/route.ts components/DatabaseUnavailablePanel.tsx app/evaluation/login/page.tsx app/admin/dashboard/page.tsx app/page.tsx lib/adminDashboardContract.test.ts
git commit -m "feat: require persistent production analytics"
```

---

### Task 5: Remove public backend navigation and document the operating model

**Files:**
- Modify: `components/AppHeader.tsx`
- Modify: `app/evaluation/EvaluationClient.tsx`
- Modify: `app/admin/dashboard/DashboardClient.tsx`
- Modify: `lib/visualRedesignContract.test.ts`
- Modify: `.env.local.example`
- Modify: `README.md`

**Interfaces:**
- Produces: public header with no backend links, and explicit admin-only links between the evaluation workspace and dashboard.

- [ ] **Step 1: Change the visual contract before the UI**

Update the header test to require:

```ts
assert.doesNotMatch(header, /href="\/dashboard"/);
assert.doesNotMatch(header, /href="\/evaluation"/);
assert.match(evaluation, /href="\/admin\/dashboard"/);
assert.match(dashboard, /href="\/evaluation"/);
```

Read `app/evaluation/EvaluationClient.tsx` and the moved dashboard source in the same test. Preserve all unrelated visual and pressed-state assertions.

- [ ] **Step 2: Run the visual contract and confirm it fails**

Run: `node --test --experimental-strip-types lib/visualRedesignContract.test.ts`

Expected: FAIL because `AppHeader` still exposes public evaluation and dashboard links.

- [ ] **Step 3: Remove internal links from the public header**

Remove `ChartBar`, `Flask`, `usePathname`, and the evaluation/dashboard `<Link>` elements from `components/AppHeader.tsx`. Keep the brand link, creation workspace label, history, and favorites behavior.

- [ ] **Step 4: Add admin-only internal navigation**

In `EvaluationClient`, render a `Link` to `/admin/dashboard` only when `initial.user.role === "admin"`, next to the storage badge and logout button.

In `DashboardClient`, add a `Link` to `/evaluation` next to the origin selector and refresh button. The page itself is already admin-only, so no additional client role prop is required.

- [ ] **Step 5: Update configuration and operator documentation**

In `.env.local.example`, state that `DATABASE_URL` is optional only for local development and required in production. In `README.md`:

- Replace public `/dashboard` instructions with `/admin/dashboard`.
- Explain first-admin setup through `/evaluation/login?next=/admin/dashboard`.
- Explain that production uses Vercel Marketplace Neon and does not use JSON fallback.
- Keep local Postgres/JSON instructions and clarify that no local database is exposed publicly.

- [ ] **Step 6: Run tests, lint, and build**

Run: `npm test`

Expected: all tests pass.

Run: `npm run lint`

Expected: no ESLint errors.

Run: `npm run build`

Expected: build succeeds and route output includes `/admin/dashboard`, `/dashboard`, `/api/dashboard/events`, and `/api/dashboard/summary`.

- [ ] **Step 7: Commit navigation and documentation**

```bash
git add components/AppHeader.tsx app/evaluation/EvaluationClient.tsx app/admin/dashboard/DashboardClient.tsx lib/visualRedesignContract.test.ts .env.local.example README.md
git commit -m "docs: explain protected analytics backend"
```

---

### Task 6: Provision Neon, deploy, and verify production end to end

**Files:**
- No tracked source files.
- Vercel project: `yueyyue/hookovo`
- Production domain: `https://hookovo.icu`

**Interfaces:**
- Consumes: Vercel Marketplace Neon integration and the application's `DATABASE_URL` contract.
- Produces: production PostgreSQL persistence, a fresh administrator account created by the user, and verified protected analytics.

- [ ] **Step 1: Confirm the source tree is ready without staging unrelated edits**

Run: `git status --short`

Expected: only the pre-existing UI changes remain uncommitted; implementation commits are cleanly recorded. Do not stage or overwrite unrelated work.

- [ ] **Step 2: Install the Vercel-managed Neon integration**

Open `https://vercel.com/marketplace/neon`, choose the Vercel-managed “Create New Neon Account” mode, select project `hookovo`, and select the free plan. Pause for user confirmation if Vercel presents terms, billing authorization, or any non-zero charge.

Expected: Neon is connected to `yueyyue/hookovo` and injects `DATABASE_URL` for Production. Do not print its value.

- [ ] **Step 3: Verify only the environment variable name and environment**

Run: `vercel env ls production`

Expected: `DATABASE_URL` is listed as encrypted for Production; `DEEPSEEK_API_KEY` remains present. No values appear.

- [ ] **Step 4: Deploy the production build**

Run: `vercel --prod --yes`

Expected: build passes, deployment reaches `READY`, and `https://hookovo.icu` is the production alias.

- [ ] **Step 5: Verify anonymous protection and public ingestion**

Run:

```bash
curl -sS -o /dev/null -D - https://hookovo.icu/admin/dashboard
curl -sS -o /tmp/hookovo-event.json -w '%{http_code}\n' \
  -X POST https://hookovo.icu/api/dashboard/events \
  -H 'Content-Type: application/json' \
  --data '{"type":"generation_start","payload":{"platform":"xiaohongshu","contentType":"video"}}'
```

Expected: anonymous dashboard request returns 307 with `Location` pointing to the internal login page; public event write returns 200. If the local resolver is intermittent, repeat with `--resolve hookovo.icu:443:76.76.21.21` after confirming public DNS still resolves to that address.

- [ ] **Step 6: Let the user create the first administrator securely**

Open `https://hookovo.icu/evaluation/login?next=/admin/dashboard`. The user enters their chosen username, display name, and password directly in the site; never request or echo the password in chat.

Expected: successful setup creates the first admin in Neon and returns the browser to `/admin/dashboard`.

- [ ] **Step 7: Generate a real Hook and verify the dashboard**

Use the public homepage to generate one Hook batch and perform one copy, favorite, or adoption action. Return to `/admin/dashboard`, refresh real-user data, and verify generation and operation metrics increase. Confirm recent events contain platform/type data but no raw topic.

- [ ] **Step 8: Verify API authorization and final health**

From an anonymous session request `/api/dashboard/summary` and expect 401. From the logged-in admin browser refresh the dashboard and expect successful data. Verify:

```bash
curl -sS -o /dev/null -w 'home=%{http_code} ssl=%{ssl_verify_result}\n' https://hookovo.icu/
vercel inspect hookovo.icu
```

Expected: homepage 200 with valid TLS, production deployment `Ready`, AI generation still returns 200, and the dashboard contains persisted events after a fresh deployment.

- [ ] **Step 9: Record final evidence**

Report the production URL, deployment ID, protected route behavior, database integration status, and the successful event-count change. Do not include credentials, connection strings, API keys, or cookies.

---

## Plan self-review record

- Spec coverage: admin route, 401/403 API behavior, legacy redirect, shared login, safe return path, Neon persistence, production fail-closed behavior, local fallback, public ingestion, privacy minimization, internal navigation, tests, deployment, and end-to-end verification are each assigned to a task.
- Placeholder scan: no implementation steps contain TBD/TODO or unspecified “add tests” instructions.
- Type consistency: `classifyAdminAccess`, `sanitizeInternalReturnPath`, `getPersistenceMode`, `getConfiguredDatabaseUrl`, and `DatabaseNotConfiguredError` use the same signatures in producer and consumer tasks.
