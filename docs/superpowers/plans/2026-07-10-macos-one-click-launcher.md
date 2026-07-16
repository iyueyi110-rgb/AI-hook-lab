# macOS One-Click Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Finder-double-clickable macOS launcher that starts one AI Hook Lab server and opens both the creator and dashboard pages.

**Architecture:** A single Bash `.command` owns dependency checks, safe environment bootstrapping, deterministic free-port selection, Next.js process lifetime, readiness probing, browser opening, and signal cleanup. A Node contract test verifies the launcher contains every required safety and lifecycle contract; a real smoke run verifies HTTP readiness and shutdown.

**Tech Stack:** Bash 3.2-compatible shell, macOS `open`/`lsof`/`curl`, npm, Next.js, Node built-in test runner.

## Global Constraints

- The default port candidates are exactly `3000 3010 3011 3012 3020`.
- The launcher must never print or upload environment variable values.
- Missing `.env.local` must be initialized from `.env.local.example` without inventing a real API key.
- One Next.js server must serve both `/` and `/dashboard`.
- `Control+C` must stop the child server and leave no listener on the selected port.
- Windows launchers and product generation behavior are out of scope.

---

### Task 1: Launcher Contract Test

**Files:**
- Create: `lib/macLauncherContract.test.ts`
- Modify: `package.json`
- Test: `lib/macLauncherContract.test.ts`

**Interfaces:**
- Consumes: repository-root file path `start-ai-hook-mac.command`.
- Produces: a test contract requiring project-directory resolution, tool checks, environment bootstrap, fixed ports, readiness probe, both URLs, and cleanup trap.

- [ ] **Step 1: Write the failing contract test**

Create a Node test that reads `start-ai-hook-mac.command` and asserts the shebang, `command -v node`, `command -v npm`, `.env.local.example`, all five port numbers, `lsof`, `curl`, `open`, `/dashboard`, and `trap cleanup` are present. Update `npm test` to run `lib/*.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`

Expected: the existing dashboard test passes and the launcher test fails with `ENOENT` because `start-ai-hook-mac.command` does not exist.

- [ ] **Step 3: Commit the red test**

```bash
git add lib/macLauncherContract.test.ts package.json
git commit -m "test: define macOS launcher contract"
```

### Task 2: macOS Launcher and Environment Template

**Files:**
- Create: `start-ai-hook-mac.command`
- Create: `.env.local.example`
- Test: `lib/macLauncherContract.test.ts`

**Interfaces:**
- Consumes: `AI_HOOK_PORT_CANDIDATES` as an optional space-separated smoke-test override and `AI_HOOK_SKIP_OPEN=1` as an optional automation flag.
- Produces: selected `PORT`, child `SERVER_PID`, HTTP endpoints `http://localhost:<PORT>/` and `http://localhost:<PORT>/dashboard`.

- [ ] **Step 1: Implement the minimal launcher**

Implement Bash functions `port_in_use`, `choose_port`, `open_pages_when_ready`, and `cleanup`, followed by `main`. `main` resolves its own directory, validates Node/npm/curl/lsof, installs missing dependencies, initializes `.env.local`, chooses a port, starts `npm run dev -- -p "$PORT"`, opens both pages only after readiness, and waits for the server.

- [ ] **Step 2: Add the safe environment example**

Create `.env.local.example` with empty `DEEPSEEK_API_KEY`, `DATABASE_URL`, and `EVAL_INGEST_TOKEN` entries plus comments describing which are optional.

- [ ] **Step 3: Make the launcher executable**

Run: `chmod +x start-ai-hook-mac.command`

- [ ] **Step 4: Verify syntax and green tests**

Run:

```bash
bash -n start-ai-hook-mac.command
npm test
```

Expected: Bash exits 0 and both Node tests pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add start-ai-hook-mac.command .env.local.example
git commit -m "feat: add macOS one-click launcher"
```

### Task 3: Usage Documentation and Real Smoke Test

**Files:**
- Modify: `README.md`
- Test: `start-ai-hook-mac.command`

**Interfaces:**
- Consumes: launcher behavior from Task 2.
- Produces: user instructions for Finder, Gatekeeper permission recovery, environment setup, selected-port discovery, and shutdown.

- [ ] **Step 1: Document macOS one-click startup**

Add a README section instructing users to double-click `start-ai-hook-mac.command`, use `chmod +x` if needed, fill `DEEPSEEK_API_KEY`, read the selected URL in Terminal, and press `Control+C` to stop. Explain that the dashboard is served by the same process.

- [ ] **Step 2: Start an isolated smoke instance**

Run:

```bash
AI_HOOK_SKIP_OPEN=1 AI_HOOK_PORT_CANDIDATES="3099" ./start-ai-hook-mac.command
```

Expected: Terminal prints `http://localhost:3099` and the server reaches ready state.

- [ ] **Step 3: Verify both pages and shutdown**

Run `curl -I http://localhost:3099/` and `curl -I http://localhost:3099/dashboard`; both must return HTTP 200. Send `Control+C`, then verify `lsof -nP -iTCP:3099 -sTCP:LISTEN` returns no listener.

- [ ] **Step 4: Run the complete quality gate**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain macOS one-click startup"
```
