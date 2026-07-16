# Simprosys QA Platform — Developer Reference

Internal QA automation platform for the Simprosys team. Two sub-projects in one monorepo.

| Sub-project | What it is |
|---|---|
| `Simprosys Automation Tool/` | Next.js app — AI test runner + 10-category website auditor. Runs at `localhost:3000`. |
| `Shopify-GSF-Tests/` | Standalone Playwright E2E suite for the Simprosys Google Shopping Feed Shopify app. |

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Quick Start](#2-quick-start)
3. [Repository Layout](#3-repository-layout)
4. [Architecture](#4-architecture)
5. [Audit Pipeline](#5-audit-pipeline)
6. [Type System](#6-type-system)
7. [SSE Streaming](#7-sse-streaming)
8. [API Routes](#8-api-routes)
9. [Key Modules](#9-key-modules)
10. [Auth & Security](#10-auth--security)
11. [Shopify GSF Tests](#11-shopify-gsf-tests)
12. [Configuration Reference](#12-configuration-reference)
13. [Development Patterns](#13-development-patterns)

---

## 1. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.2.6 |
| UI | React | 19.2.4 |
| Language | TypeScript (strict mode) | 5.x |
| Browser automation | Playwright | 1.60.0 |
| AI — text/code | Ollama `qwen2.5-coder:14b` | local |
| AI — vision | Ollama `gemma4` | local |
| Accessibility | axe-core (injected at runtime) | bundled in `public/vendor/` |
| Persistence | File-based NDJSON + per-job JSON | built-in (`audits/`) |

---

## 2. Quick Start

### Prerequisites

- Node.js 20+
- [Ollama](https://ollama.com) installed and running (`ollama serve`)
- Models pulled:
  ```
  ollama pull qwen2.5-coder:14b
  ollama pull gemma4
  ```

### Install & Run

```bash
# 1. Install dependencies
cd "Simprosys Automation Tool"
npm install

# 2. Install Playwright browsers
npx playwright install chromium

# 3. Start dev server
npm run dev
# → http://localhost:3000
```

> **After system sleep:** The dev server must be restarted. Playwright browser contexts don't survive a suspended process.

### Enable Auth (optional)

Auth is disabled by default. To protect the tool from local-network access, add to `.env.local`:

```env
ADMIN_PASSWORD=your-password-here
SESSION_SECRET=$(openssl rand -base64 32)
```

A login page appears at `/login`. Sessions last 24 hours. A "Sign out" button appears fixed at the bottom-right of the app.

---

## 3. Repository Layout

```
Simprosys Automation Tool/
├── src/
│   ├── app/                          # Next.js App Router pages + API routes
│   │   ├── page.tsx                  # Main UI — Welcome / AI Tool / Automation / Inspector (1,095 lines)
│   │   ├── layout.tsx                # Root layout — fonts, global CSS, LogoutButton
│   │   ├── login/page.tsx            # ★ Auth login page
│   │   └── api/
│   │       ├── run-test/route.ts     # Execute Playwright test (AI or direct code)
│   │       ├── chat/route.ts         # Streaming AI chat
│   │       ├── inspect-page/route.ts # Synchronous single-page snapshot
│   │       ├── auth/
│   │       │   ├── login/route.ts    # ★ POST — set session cookie
│   │       │   └── logout/route.ts   # ★ POST — clear session cookie
│   │       └── audit/
│   │           ├── start/route.ts    # POST — create job, fire background pipeline
│   │           ├── stream/[jobId]/   # GET  — SSE stream of progress events
│   │           ├── result/[jobId]/   # GET  — completed result (memory → disk fallback)
│   │           ├── history/          # GET  — list past audits from disk
│   │           ├── export/[jobId]/   # ★ GET — download HTML report
│   │           └── capabilities/     # GET  — available auditor categories
│   ├── components/
│   │   ├── WebsiteInspector.tsx      # Full audit UI — 15 tabs, SSE client (1,215 lines)
│   │   └── LogoutButton.tsx          # ★ Client component — sign out
│   ├── lib/
│   │   ├── auditPipeline.ts          # 7-phase audit orchestrator (~670 lines)
│   │   ├── auditJobManager.ts        # In-memory job store (globalThis singleton)
│   │   ├── auditHistory.ts           # File-based persistence (NDJSON + JSON)
│   │   ├── auditEventBus.ts          # Pub/sub for SSE events
│   │   ├── browserManager.ts         # Playwright browser lifecycle
│   │   ├── ollama.ts                 # Ollama client — generate, chat, vision
│   │   ├── urlUtils.ts               # URL normalization, robots.txt, sitemap
│   │   ├── scoringEngine.ts          # Grade + score calculation
│   │   ├── codeGuard.ts              # Regex-based dangerous code blocker
│   │   ├── auditors/                 # 9 category auditors
│   │   │   ├── seoAuditor.ts
│   │   │   ├── accessibilityAuditor.ts
│   │   │   ├── performanceAuditor.ts
│   │   │   ├── securityAuditor.ts
│   │   │   ├── uiuxAuditor.ts
│   │   │   ├── contentAuditor.ts
│   │   │   ├── techAuditor.ts
│   │   │   ├── functionalAuditor.ts
│   │   │   └── visualAuditor.ts      # Vision model screenshots
│   │   └── aiGenerators/             # 4 AI output generators
│   │       ├── recommendationGenerator.ts
│   │       ├── qaTestGenerator.ts
│   │       ├── playwrightGenerator.ts
│   │       └── fixGenerator.ts
│   └── types/
│       └── audit.ts                  # Single source of truth for all data contracts (741 lines)
├── src/middleware.ts                  # ★ Auth middleware (runs at Edge)
├── audits/                           # Auto-created — history.ndjson + <jobId>.json files
├── public/vendor/axe.min.js          # Bundled axe-core, injected into pages at runtime
├── .env.local                        # Env vars (never commit)
├── next.config.ts
└── tsconfig.json

Shopify-GSF-Tests/
├── tests/simprosys-gsf.spec.ts       # 8 E2E tests
├── tests/auth.setup.ts               # Manual 2FA login flow
├── extract-shopify-cookies.js        # Chrome cookie extraction alternative
└── playwright.config.ts              # Headless OFF, 1440×900, 120s timeout
```

> Items marked **★** were added in Layer 1 hardening.

---

## 4. Architecture

The app is a single Next.js process. The UI and all API routes live in the same server. There is no external backend, no database, no cloud dependency — only the Ollama process running alongside.

```
Browser (localhost:3000)
  │
  │  page.tsx  ─────── React state machine: 4 views
  │  WebsiteInspector.tsx ── SSE consumer, 15-tab results UI
  │
  ↓  HTTP / EventSource
Next.js Server (Node.js runtime)
  │
  ├── /api/run-test          ── Playwright execution (VM-sandboxed)
  ├── /api/audit/start       ── Spawns background audit job
  ├── /api/audit/stream/:id  ── SSE push (keepalive every 15s)
  ├── /api/audit/result/:id  ── Serves completed result
  ├── /api/chat              ── Streaming chat via Ollama
  └── /api/inspect-page      ── Synchronous single-page audit
  │
  ├── lib/auditPipeline.ts   ── Orchestrates 7 phases
  ├── lib/auditJobManager.ts ── In-memory jobs (globalThis singleton)
  ├── lib/auditHistory.ts    ── Disk persistence (audits/)
  └── lib/auditEventBus.ts   ── SSE pub/sub bridge
  │
  ↓  HTTP (localhost:11434)
Ollama (local process)
  ├── qwen2.5-coder:14b  ── Code generation, recommendations, test cases
  └── gemma4             ── Vision analysis of page screenshots
```

> **HMR safety:** `auditJobManager.ts` stores jobs in `globalThis.__auditJobs`. Next.js HMR re-evaluates modules on save, which would reset a module-level `Map`. Using `globalThis` as the backing store survives hot reloads.

---

## 5. Audit Pipeline

`src/lib/auditPipeline.ts` is the core orchestrator. It runs as a fire-and-forget background job triggered by `POST /api/audit/start`. Progress events are pushed to clients via the SSE event bus.

| Phase | Name | What happens |
|---|---|---|
| 01 | **Crawl** | BFS URL discovery. Reads `robots.txt` and sitemap. Respects `crawlMode` (single / topPages / fullCrawl). Caps at `maxPages`. |
| 02 | **Per-page audit** | Each URL is passed through all enabled auditors: SEO, Accessibility (axe-core), Performance, Security, UI/UX, Content, Tech, Functional. |
| 03 | **Visual AI** | Desktop + mobile screenshots sent to Ollama `gemma4`. Returns visual issues, layout problems, contrast observations. |
| 04 | **AI Recommendations** | `qwen2.5-coder:14b` synthesises all issues into prioritised recommendations with code examples. |
| 05 | **QA Test cases** | AI generates manual QA test cases in Given/When/Then format. |
| 06 | **Playwright suite + fixes** | AI writes a runnable Playwright test file and specific code fixes for each issue. |
| 07 | **Scoring + persist** | Scores calculated via `scoringEngine.ts`. Result saved to `audits/<jobId>.json`. Index entry appended to `audits/history.ndjson`. |

### Auditor contract

Every auditor in `src/lib/auditors/` exports a single async function:

```typescript
async function run*Audit(
  page: Page,
  url: string,
  options?: AuditorOptions
): Promise<CategoryResult>
```

They receive an already-navigated Playwright `page` and return a typed result object. They do not manage the browser lifecycle. Adding a new category means adding a new file here and wiring it into `auditPipeline.ts`.

---

## 6. Type System

All data contracts live in one file: **`src/types/audit.ts`** (741 lines). Every auditor, every API route, and the entire UI imports from here. Do not duplicate type definitions elsewhere.

| Type | Purpose |
|---|---|
| `AuditConfig` | Input to the pipeline: URL, crawlMode, maxPages, categories, crawlDelayMs |
| `AuditJob` | Live job state: jobId, status, progress, currentPhase, crawlProgress |
| `SiteAuditResult` | Complete result: pages[], healthScore, siteWide, recommendations, qaTestCases, playwrightSuite, fixes |
| `PageAuditResult` | Per-page result with typed fields for each auditor category |
| `AuditIssue` | A single issue: title, description, severity (`'critical'│'warning'│'info'`), category, fixSuggestion |
| `SiteHealthScore` | overall (0–100), grade (`'A'│'B'│'C'│'D'│'F'`), breakdown (CategoryScores) |
| `AuditSSEEvent` | Discriminated union of all SSE event shapes — exhaustive switch in client |
| `AuditIndexEntry` | Lightweight summary written to `history.ndjson` (metadata only, no page data) |

---

## 7. SSE Streaming

Live audit progress is pushed to the browser using Server-Sent Events. Three modules are involved:

```typescript
// 1. Pipeline emits events
// src/lib/auditPipeline.ts
emitEvent(jobId, { type: 'phase_start', phase: 'crawl', totalProgress: 5 });

// 2. Event bus holds the subscriber queue
// src/lib/auditEventBus.ts
const subs = new Map<string, Set<Subscriber>>();

// 3. SSE route subscribes and flushes to the client
// src/app/api/audit/stream/[jobId]/route.ts
const stream = new ReadableStream({
  start(controller) {
    subscribe(jobId, (event) => {
      controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    });
  }
});
// A keepalive comment is sent every 15s to prevent proxy timeouts
```

The client (`WebsiteInspector.tsx`) opens an `EventSource`, switches on `event.type` to update React state, and closes the connection on receiving a `complete` or `error` event.

---

## 8. API Routes

### `POST /api/run-test`

Executes a Playwright automation script in two modes:

| Mode | Trigger | Flow |
|---|---|---|
| AI mode | Send `instructions` | Ollama converts plain English → Playwright JS → executes |
| Direct mode | Send `directCode` | Skips Ollama — runs code directly after `codeGuard` check |

```typescript
// Request
{
  url: "https://example.com",
  instructions: "Click the login button",  // AI mode
  // OR
  directCode: "await page.click('button#login')",  // direct mode
  variables: { email: "test@example.com" },
  reusableRules: {}
}

// Response
{
  success: true,
  logs: [{ type: "info", message: "..." }],
  code: "...",            // generated or supplied code
  screenshot: "base64...", // full-page PNG
  variables: {},
  interactiveElements: []
}
```

> **Sandbox:** The script runs inside `vm.createContext()` — an isolated V8 context. `process`, `require`, `__dirname`, and all Node.js globals are out of scope. A 90-second `Promise.race` enforces a hard deadline.

### `POST /api/audit/start`

Creates a job and fires the pipeline as a background promise. Returns `{ jobId }` immediately — do not await the pipeline.

```typescript
// Request
{
  url: "https://example.com",
  crawlMode: "single" | "topPages" | "fullCrawl",
  maxPages: 10,           // capped at 200
  categories: ["seo", "accessibility", "performance", ...],
  crawlDelayMs: 500
}

// Response (immediate)
{ jobId: "audit_1234567890_000001" }
```

### `GET /api/audit/stream/:jobId`

Server-Sent Events stream. Sends progress events as `data: JSON\n\n`. Keepalive comment every 15 seconds. Close on `complete` or `error` event type.

### `GET /api/audit/result/:jobId`

Returns the full `SiteAuditResult`. Checks in-memory first, then falls back to `audits/<jobId>.json` on disk. Works correctly after a server restart.

### `GET /api/audit/history`

Reads `audits/history.ndjson` and returns newest-first `AuditIndexEntry[]`.

### `GET /api/audit/export/:jobId` ★

Returns a self-contained HTML report as a file download. Includes all issues, scores, recommendations, and pages crawled.

### `GET /api/audit/capabilities`

Returns available auditor categories. Used by the UI to populate the category selector.

### `POST /api/chat`

Streaming chat with `qwen2.5-coder:14b`. Returns `text/event-stream`. Used by the persistent AI Chat sidebar.

### `POST /api/inspect-page`

Synchronous single-page audit. Runs all auditors inline and returns the result in the HTTP response. No background job, no SSE.

### `POST /api/auth/login` ★

Verifies `password` against `ADMIN_PASSWORD`. On success, sets an `httpOnly`, `sameSite=strict` session cookie signed with HMAC-SHA256.

### `POST /api/auth/logout` ★

Clears the session cookie.

---

## 9. Key Modules

### `auditPipeline.ts`

The central orchestrator. Entry point: `runAuditJob(job)`. Manages the browser lifecycle, coordinates all phases, emits SSE events at each transition, and calls `saveResult` + `appendHistoryEntry` on completion.

> **Never import from the pipeline in API routes.** The only correct caller is `/api/audit/start`, which calls `runAuditJob(job)` without `await`.

---

### `auditJobManager.ts`

In-memory job store using the `globalThis` singleton pattern. Three `Map`s: `jobs`, `results`, `expiry`. TTLs: jobs kept 2 hours, full results evicted from memory after 30 minutes (but already persisted to disk by the pipeline).

`getJob(jobId)` falls back to reconstructing a minimal job record from the disk result if the job is not in memory — so the history tab works after server restarts:

```typescript
// If in-memory map is empty (after restart), reconstruct from disk:
const diskResult = loadResult(jobId);
if (diskResult) return { status: 'complete', totalProgress: 100, ...diskResult.config };
```

---

### `auditHistory.ts`

File-based persistence. No external database. Creates the `audits/` directory at the project root on first use.

| Function | What it writes |
|---|---|
| `saveResult(result)` | Writes full `SiteAuditResult` to `audits/<jobId>.json` |
| `appendHistoryEntry(entry)` | Appends a lightweight index entry to `audits/history.ndjson` (one JSON object per line) |
| `loadResult(jobId)` | Reads and parses `audits/<jobId>.json`. Returns `null` if not found. |
| `readHistory(limit)` | Parses `history.ndjson`, returns newest-first slice. Skips malformed lines. |
| `pruneOldResults(days)` | Deletes `.json` files older than `maxAgeDays`. Run manually if disk fills up. |

---

### `auditEventBus.ts`

A lightweight pub/sub hub bridging the background pipeline to the SSE route. Subscribers are keyed by `jobId`.

```typescript
emitEvent(jobId, event)      // pipeline → bus
subscribe(jobId, callback)   // SSE route → bus
unsubscribe(jobId, callback) // SSE route cleanup on client disconnect
closeJobStream(jobId)        // pipeline signals job done
```

---

### `browserManager.ts`

Playwright browser lifecycle management. Provides `launchBrowser()`, `createAuditPage()`, `navigateTo()`, `takeScreenshot()`, and `runAxe()`.

`runAxe(page)` injects `public/vendor/axe.min.js` into the page via `page.addScriptTag()` and calls `axe.run()` to get accessibility violations. This runs axe in the browser context where it belongs — not as a Node.js module.

`VIEWPORTS` exports standard desktop (1440×900) and mobile (390×844) viewport configs used by the visual auditor.

---

### `ollama.ts`

HTTP client for the local Ollama process at `OLLAMA_BASE_URL`.

| Export | Purpose |
|---|---|
| `generate(prompt, opts)` | One-shot text generation. Returns full string. Used for code generation. |
| `chat(messages, opts)` | Multi-turn conversation. Returns assistant message string. |
| `chatStream(messages, opts)` | Returns async iterator of string chunks. Used by the chat API route. |
| `analyzeImages(imgs, prompt)` | Sends base64 screenshots to the vision model (`gemma4`). |
| `extractJson(text)` | Strips markdown fences and parses JSON from AI-generated structured output. |

---

## 10. Auth & Security

### Middleware (`src/middleware.ts`)

Runs at the Edge runtime before every request. If `ADMIN_PASSWORD` is not set, all requests pass through without checking.

Session token format: `{expiry_timestamp}.{hmac_sha256_base64}`

```
POST /api/auth/login  →  sets qa_session cookie (httpOnly, sameSite=strict, 24h)
GET  /any-route       →  middleware verifies HMAC and expiry
POST /api/auth/logout →  sets cookie maxAge=0 (browser deletes it)
```

Routes always allowed through without a session: `/login`, `/api/auth/*`, `/_next/*`, `/favicon.ico`.

Unauthenticated API requests receive `401 JSON`. Unauthenticated page requests are redirected to `/login`.

---

### VM Sandbox (`src/app/api/run-test/route.ts`)

User-supplied test code runs inside `vm.createContext()` — a separate V8 context. The sandbox receives only what it needs:

```typescript
const sandbox = vm.createContext({
  // Playwright API — the only server-side objects exposed
  page, context, browser,
  // QA helpers
  expect, console: customConsole, storedVariables,
  // JS built-ins only (no process, require, __dirname, global, etc.)
  Promise, setTimeout, JSON, Math, URL, ...
});
```

A 90-second `Promise.race` deadline handles hung async operations that Playwright's own timeouts don't catch.

---

### `codeGuard.ts`

A regex-based pre-flight check that runs on all user-supplied code **before** it reaches the VM sandbox. Blocks:

- `require(` — Node module loading
- `process.` — process env / exit access
- `child_process` — shell execution
- `fs.read/write/unlink/mkdir/rm/access/open/stat` — filesystem access
- `eval(` — dynamic evaluation
- `new Function(` — dynamic function construction
- `import(` — dynamic module import

> **Defence in depth:** `codeGuard` is the first layer; the VM sandbox is the second. Both are required. The VM prevents runtime access; codeGuard prevents obfuscated payloads that might bypass the sandbox.

---

## 11. Shopify GSF Tests

A standalone Playwright project in `Shopify-GSF-Tests/`. Kept separate because Shopify admin detects and blocks headless browsers.

### Auth setup (required before first run)

```bash
# Option A — manual login flow
npm run auth
# Opens real Chrome. Type email, then page.pause() waits for manual 2FA.
# Session saved to playwright/.auth/user.json

# Option B — extract from running Chrome
# Launch Chrome with --remote-debugging-port=9222, then:
node extract-shopify-cookies.js
# Connects to Chrome DevTools, extracts cookies, saves to user.json
```

### Run tests

```bash
npm test
# Runs 8 tests in headed Chromium (headless: false)
# 120s timeout per test, 0 retries, 1440×900 viewport
```

### The 8 tests

1. App loads without error
2. Google Shopping Feed — Connected (Merchant ID 5730989431)
3. XML Feed Active
4. Manage Products tab loads
5. Settings tab loads
6. Tracking Tags configured
7. Campaigns tab loads
8. Promotions Feed tab loads

> **Bot detection:** `auth.setup.ts` uses `pressSequentially` at 150ms delay instead of `fill()` to mimic human typing. The runner disables Chrome's `AutomationControlled` flag. Switching to headless mode or `fill()` will likely trigger Shopify's bot detection and break the auth flow.

---

## 12. Configuration Reference

All variables go in `.env.local` at the project root. This file is never committed.

| Variable | Default | Required | Description |
|---|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5-coder:14b` | Yes | Text/code model for AI generation and recommendations |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Yes | Ollama server URL |
| `ADMIN_PASSWORD` | *(unset = no auth)* | No | Enables the login wall. Leave unset for local single-user use. |
| `SESSION_SECRET` | `dev-secret-change-me` | No | HMAC key for signing session cookies. Set to a random value when using auth: `openssl rand -base64 32` |

### Ollama models

| Model | Used for |
|---|---|
| `qwen2.5-coder:14b` | Code generation, AI recommendations, QA test cases, Playwright suite, fix suggestions, AI chat |
| `gemma4` | Visual analysis — desktop and mobile screenshots |

---

## 13. Development Patterns

### Next.js 16 — `params` is a Promise

Dynamic route params are async in Next.js 15+. Always `await params`:

```typescript
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params; // ← required
}
```

### `globalThis` singletons (HMR safety)

Module-level state resets on every hot-reload. Use this guard pattern for any long-lived server-side state:

```typescript
const g = globalThis as Record<string, unknown>;
if (!g.__myStore) g.__myStore = new Map();
const store = g.__myStore as Map<string, MyType>;
```

### Fire-and-forget background jobs

```typescript
// Correct — do NOT await the pipeline
const job = createJob(config);
runAuditJob(job);  // intentionally un-awaited
return NextResponse.json({ jobId: job.jobId });
```

### Adding a new auditor

1. Create `src/lib/auditors/myAuditor.ts` — export `runMyAudit(page, url, opts)`
2. Add the category string to the `AuditCategory` union in `src/types/audit.ts`
3. Add the result type to `PageAuditResult` in `src/types/audit.ts`
4. Import and call it in the per-page audit loop in `src/lib/auditPipeline.ts`
5. Add a tab in `TABS` in `src/components/WebsiteInspector.tsx`

### Do not

- Duplicate type definitions outside `src/types/audit.ts`
- Store module-level state without the `globalThis` guard
- Add `export const runtime = 'edge'` to route handlers — they need Node.js APIs
- Import from `auditPipeline.ts` outside of `/api/audit/start`
- Use `new AsyncFunction()` for user code execution — use `vm.createContext()` instead
