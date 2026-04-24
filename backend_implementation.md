# AI Reporter — Backend Implementation Guide

> Step-by-step implementation reference. Each step is reviewed before moving to the next.  
> Full design decisions and schema live in `backend_plan.md`.

---

## How we work

- One step at a time — plan is written to this file first, reviewed and approved, then executed.
- Every file has a clear **What** and **Why** so nothing is a black box.
- We follow Phase 0 → 6 order. We do not skip ahead.

---

## Status

| Phase | Status |
|---|---|
| Phase 0 — Frontend Audit & Cleanup | ✅ Complete |
| Phase 1 — Foundation | 🔲 Next |
| Phase 2 — CRUD APIs | 🔲 Not started |
| Phase 3 — Broadcast Engine | 🔲 Not started |
| Phase 4 — Webhooks & Conversations | 🔲 Not started |
| Phase 5 — Frontend Cutover | 🔲 Not started |
| Phase 6 — Production Hardening | 🔲 Not started |

---

## Phase 0 — Frontend Audit & Cleanup ✅ Complete

Goal: understand exactly what is in `AI_Reporter.html`, remove everything that cannot go to production, and document what each section will be replaced with. This phase produces no backend code — only a clean, honest frontend.

**Why this comes first:**  
We cannot build an API contract without knowing what the frontend currently does. And two issues found in the audit are security problems that must be fixed before the app is ever deployed — even to staging.

**What was done (2026-04-24):**
- ✅ 0.1 Audit documented
- ✅ 0.2 + 0.3 All seed constants and localStorage RBAC layer removed. Replaced with empty stubs (`loadPlatformUsers → []` etc.). `EMPLOYEES=[]`, `CONVERSATIONS={}`, `BROADCASTS=[]`.
- ✅ 0.4 Mock `SessionProvider` replaced with Supabase JS client auth. `LoginWall` replaced with email/password form. "Switch user (demo)" modal deleted. JWT in React state only.
- ✅ 0.5 `TWILIO_LS_KEY`, `loadTwilio()`, credential form deleted. Replaced with read-only `TwilioStatusCard`.
- ✅ 0.6 React CDN switched to `production.min.js`. Supabase JS CDN added. Babel kept until Phase 5 build step.
- ✅ 0.7 `const USE_API = false` added.
- ✅ Extra: `schema.sql` created with full DB schema + RLS enabled. Auth trigger syncs `auth.users` → `public.users`. App tested and login working.

**Known issue fixed during execution:**  
Supabase CDN declares a global `var supabase`. Our code used the same name causing `SyntaxError: Identifier 'supabase' has already been declared`. Fixed by renaming our client instance to `supabaseClient`.

---

### Step 0.1 — Full audit of demo/fake data (read-only)

**What was found in `AI_Reporter.html`:**

#### A. Demo seed constants (lines 179–393)
These are hardcoded arrays/objects used as the fake "database":
- `EMPLOYEES` — 5 fake employees with `(555)` phone numbers (appears twice in file)
- `CONVERSATIONS` — fake multi-turn conversation history with hardcoded messages
- `BROADCASTS` — fake broadcast list
- `BASE_PLATFORM_USERS_SEED` / `GENERATED_PLATFORM_USERS_SEED` / `PLATFORM_USERS_SEED` — 300 generated demo users including `robert@demo.com`, `pat@demo.com`, etc.
- `BASE_GROUPS_SEED` / `GROUPS_SEED` — 100 generated demo groups
- `GROUP_MEMBERS_SEED`, `MANAGER_GROUPS_SEED`, `EMPLOYEE_MANAGERS_SEED`
- `MANAGER_QUESTIONS_SEED`, `MANAGER_SCHEDULES_SEED`
- `DEMO_TARGET_USERS = 300`, `DEMO_TARGET_GROUPS = 100`

**Action:** Delete all. Replace with empty states + API calls.

#### B. localStorage as the data layer (throughout file)
The entire data layer is localStorage:
- `RBAC_LS` — object with keys for every entity (`users`, `groups`, `groupMembers`, `managerGroups`, `employeeManagers`, `managerQuestions`, `managerSchedules`)
- `load*` / `save*` functions for every entity (`loadPlatformUsers`, `saveGroups`, etc.)
- `ensureAllLocalStorageDemoData()` — seeds 300 users + 100 groups into localStorage on startup
- `rbacParse()` — reads localStorage with SEED as fallback
- All `localStorage.getItem` / `localStorage.setItem` calls for business data

**Action:** Delete all. Replace with API calls per domain (Phase 5).

#### C. Mock auth (lines 80–167)
- `SessionProvider` stores session in `SESSION_LS` localStorage key
- `login()` accepts any user payload — no password verification
- `logout()` just removes the localStorage key
- Session contains `viewerManagerIds`, `activeManagerId`, `managerPartitionId` — all demo-era fields
- "Switch user (demo)" modal (line 874) — lets anyone instantly become any user

**Action:**  
- Replace `SessionProvider` with Supabase JS client auth.
- Delete "Switch user (demo)" modal entirely — must not exist in production.
- Session fields derived from API (`GET /auth/me`) not stored in localStorage.

#### D. `managerPartitionId` throughout (demo artifact)
Every manager user has a `managerPartitionId` field. This is a demo concept — in production, scope is derived via `ManagerGroup` joins. This field appears in:
- `PLATFORM_USERS_SEED` entries
- `employeesForManager(managerPartitionId)` function
- `getViewerManagerPartitionIdsFromGroups()` function
- Session object

**Action:** Remove all references. Scope comes from the API.

#### E. Twilio credentials stored in localStorage (SECURITY ISSUE — line 4142)
```javascript
const TWILIO_LS_KEY = "ai_reporter_twilio_v1";
// saves accountSid + authToken to localStorage
localStorage.setItem(TWILIO_LS_KEY, JSON.stringify({ accountSid, authToken, fromNumber }))
```
The `authToken` is a Twilio master credential. Storing it in localStorage means:
- Any JavaScript on the page (including injected scripts) can read it.
- Browser extensions can read it.
- XSS vulnerability instantly leaks the Twilio account.

**Action:** Delete `TwilioIntegrationPanel` localStorage save/load. Replace with read-only display of server-confirmed config status (`GET /auth/me` or a dedicated settings endpoint). The actual credentials live in env vars on the server only — never in the browser.

#### F. React development bundles + Babel in browser (PERFORMANCE ISSUE — lines 75–77)
```html
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
```
Problems:
- `react.development.js` is ~1MB unminified with dev-only warnings. Production should use `react.production.min.js`.
- `babel.min.js` (~900KB) transpiles all JSX in the browser on every page load — 5000+ lines of code re-compiled every visit.
- `unpkg.com` is a CDN not guaranteed for production SLAs.

**Action:** Replace with pinned production builds. Long term: proper build step (Vite/esbuild) that bundles and minifies. Short term acceptable: switch to `.production.min.js` CDN URLs + remove Babel standalone by pre-compiling JSX.

---

### Step 0.2 — Remove seed constants

**What:** Delete all `*_SEED` constants and `DEMO_TARGET_*` from the file.

**Why now:** Every other piece of mock logic depends on these constants. Removing them first makes all the other mock code clearly broken — easier to find and replace.

**Result:** The file will have obvious errors (references to deleted constants). That is intentional — we use those errors as a checklist of what still needs API wiring.

---

### Step 0.3 — Remove localStorage data layer

**What:** Delete `RBAC_LS`, all `load*` / `save*` functions, `rbacParse()`, `ensureAllLocalStorageDemoData()`, and all `localStorage.getItem/setItem` calls for business entities.

**Why:** localStorage must not be the authority for any business data in production. Each function is replaced in Phase 5 with an API call.

**Replacement map:**

| Old (localStorage) | New (API) |
|---|---|
| `loadPlatformUsers()` | `GET /api/v1/users` |
| `saveGroups(rows)` | `POST/PATCH /api/v1/groups` |
| `loadManagerQuestions()` | `GET /api/v1/managers/:id/questions` |
| `loadManagerSchedules()` | `GET /api/v1/managers/:id/schedules` |
| `loadGroupMembers()` | `GET /api/v1/groups/:id/members` |
| `loadManagerGroups()` | `GET /api/v1/manager-groups` |

---

### Step 0.4 — Remove mock auth + "Switch user" modal

**What:**  
- Delete the `SessionProvider` mock login/logout implementation.
- Delete the "Switch user (demo)" modal completely.
- Replace with Supabase JS client auth.

**New auth flow:**
```javascript
// Sign in
const { data, error } = await supabase.auth.signInWithPassword({ email, password })

// Get session + derived scope
const me = await fetch('/api/v1/auth/me', {
  headers: { Authorization: `Bearer ${data.session.access_token}` }
}).then(r => r.json())

// Store access_token in memory only (React state) — never localStorage
```

**Why memory only for JWT:**  
localStorage is accessible by any script. Memory (React state) is cleared on tab close and not accessible to extensions or XSS.

---

### Step 0.5 — Fix Twilio credentials (security fix)

**What:**  
- Delete `TWILIO_LS_KEY`, `loadTwilio()`, and all localStorage saves in `TwilioIntegrationPanel`.
- Replace the Integrations screen with a read-only status panel: "Twilio is configured" / "Twilio is not configured" — based on `GET /auth/me` or a `GET /api/v1/integrations/status` endpoint.
- Credentials are never shown or stored in the browser.

**Why this is Phase 0 (not Phase 5):**  
This is a security fix, not just a migration. It must happen before the app is deployed anywhere — including staging.

---

### Step 0.6 — Switch to production React bundles

**What:**  
Replace the three `<script>` tags:
```html
<!-- Before -->
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<!-- After (short term) -->
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<!-- Babel removed — JSX pre-compiled in build step -->
```

**Long term (Phase 5):** proper Vite build that bundles everything, tree-shakes, and produces a single optimized JS file served from `@fastify/static`.

---

### Step 0.7 — Add `USE_API` flag

**What:**  
Add `const USE_API = false` at the top of the JS section. All new API calls are gated behind this flag per domain. Flip to `true` as each domain's API is ready.

**Why:** Safe rollback — if an API endpoint has a bug, flip `USE_API` back to `false` for that domain while we fix it. No full revert needed.

---

## Phase 1 — Foundation 🔲 Next

Goal: a running server with health check, auth middleware, and graceful shutdown. No business logic yet.

**Before starting:** Resolve open decisions:
- [x] Production hosting → **Railway** (v1). Portable to any platform — see portability rules below.
- [x] Hard vs soft delete → **Soft delete** (`deleted_at` timestamp, rows kept). Every query filters `WHERE deleted_at IS NULL`.
- [x] Twilio credentials → **Optional env vars**. App starts without them — SMS features are disabled until set. Credentials never touch the database. See secret management evolution below.
- [x] SMS provider → **Abstracted behind `twilio.service.ts`**. Migrating to Vonage, Plivo, or AWS SNS = replace one file + swap env vars. Nothing else changes.

**Secret management evolution:**
- v1: Railway dashboard (set vars manually via UI or `railway variables set`). Railway encrypts and masks them in logs.
- v2: Doppler — one source of truth synced to Railway, staging, and local `.env`. Right when you have multiple environments.
- v3: AWS Secrets Manager / Kubernetes Secrets — if hosting moves to AWS/k8s. External Secrets Operator pulls from AWS Secrets Manager into k8s Secrets automatically.

The app code is identical across all three. `config.ts` reads `process.env` — the platform is responsible for populating it, whatever the platform is.

**Steps in this phase:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (in order, each reviewed before next)

**Portability rules (enforced throughout all phases):**
- All config via environment variables only — no hardcoded hosts, ports, or credentials
- `REDIS_URL` as a single connection string — works with Railway Redis, Upstash, ElastiCache, or local
- `DATABASE_URL` / `DATABASE_URL_DIRECT` — works with any PostgreSQL host
- Dockerfile uses standard Node.js base image — runs on Railway, Fly.io, ECS, EC2, or any VPS
- No Railway-specific SDK or platform API used anywhere in app code
- `PORT` env var controls the listen port (Railway injects this automatically; other platforms do too)

---

### Step 1 — Project scaffold

**Full directory structure created in this step:**
```
backend/
├── docs/
│   └── adding-sms-provider.md       ← guide for adding future SMS providers
├── prisma/
│   └── schema.prisma
├── src/
│   ├── routes/
│   │   ├── health.ts
│   │   ├── auth.ts
│   │   ├── users.ts
│   │   ├── groups.ts
│   │   ├── participants.ts
│   │   ├── questions.ts
│   │   ├── schedules.ts
│   │   └── webhooks.ts
│   ├── middleware/
│   │   └── rbac.ts
│   ├── services/
│   │   ├── sms/
│   │   │   ├── sms.provider.interface.ts   ← contract every provider must implement
│   │   │   ├── sms.factory.ts              ← reads SMS_PROVIDER env var, returns provider
│   │   │   ├── sms.service.ts              ← bundle building + length enforcement (provider-agnostic)
│   │   │   └── providers/
│   │   │       └── twilio.provider.ts      ← Twilio implementation (only provider for now)
│   │   ├── ai.service.ts
│   │   └── broadcast.service.ts
│   ├── jobs/
│   │   ├── queue.ts
│   │   ├── broadcast.worker.ts
│   │   ├── conversation.worker.ts
│   │   ├── reminder.worker.ts
│   │   └── scheduler.ts
│   ├── config.ts
│   ├── db.ts
│   ├── app.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── .env.example
```

**What:**  
Set up the Node.js + TypeScript project with all dependencies declared, compiler options configured, and the environment variable template written out.

**Why:**  
- `package.json` declares every dependency from `backend_plan.md` §13 so `npm install` produces a reproducible tree.
- `tsconfig.json` with `"strict": true` catches type errors at compile time — not at runtime in production.
- `.env.example` documents every required env var (from `backend_plan.md` §12) so any developer or CI environment knows exactly what to set. We never commit `.env`.
- `prisma/schema.prisma` is the single source of truth for the DB — all models, enums, indexes, and constraints from `backend_plan.md` §4.
- `docs/adding-sms-provider.md` documents exactly how to add a future SMS provider — so future developers use the abstraction correctly instead of bypassing it.

**Key `tsconfig.json` settings:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Why `strict: true`:**  
Enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes` etc. This means TypeScript will catch `undefined` access, missing returns, and unsafe casts before they reach production.

**Why `ES2022` + `NodeNext`:**  
Node.js 20 supports ES2022 natively. `NodeNext` module resolution handles ESM/CJS correctly with `.js` extensions in imports.

---

### Step 2 — `config.ts` (env validation)

**File:** `backend/src/config.ts`

**What:**  
A Zod schema that reads `process.env`, validates every required variable, and exports a typed `config` object. Required vars throw on startup with a clear error — before any request is ever served. Optional vars (Twilio) default to `null` and gate their features at runtime.

**Why:**  
- Required vars fail fast — a missing `DATABASE_URL` surfaces immediately on deploy, not under load.
- Twilio is **optional**: if credentials are not set, the app starts normally with a warning log. Every SMS call checks `config.twilio` first and returns a clear error if `null`. This allows deployment and initial setup before Twilio is configured.
- Zod gives typed access (`config.twilio?.authToken`) everywhere — no `process.env.X!` scattered through the codebase.

**Pattern:**
```typescript
const schema = z.object({
  database: z.object({ url: z.string().url(), directUrl: z.string().url() }),
  supabase: z.object({ url: z.string(), serviceRoleKey: z.string(), jwtSecret: z.string() }),
  twilio: z.object({        // optional — null if any var is missing
    accountSid: z.string(),
    authToken: z.string(),
    fromNumber: z.string(),
  }).nullable().default(null),
  anthropic: z.object({ apiKey: z.string() }),
  redis: z.object({ url: z.string() }),
  sms: z.object({ maxLength: z.coerce.number().default(459) }),
  // ... all other vars
})

export const config = schema.parse({ /* map process.env */ })

// On startup, warn if Twilio is not set
if (!config.twilio) {
  logger.warn('Twilio not configured — SMS features disabled. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.')
}
```

---

### Step 3 — `db.ts` (Prisma singleton)

**File:** `backend/src/db.ts`

**What:**  
A single exported `prisma` instance of `PrismaClient`.

**Why:**  
- Node.js caches modules — importing `db.ts` anywhere always returns the same instance.
- Without this, every file that does `new PrismaClient()` opens its own connection pool, exhausting the DB quickly.
- In development with hot-reload (`tsx watch`), we attach the instance to `global` to prevent creating a new client on every file change.

**Pattern:**
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

---

### Step 4 — `app.ts` (Fastify factory)

**File:** `backend/src/app.ts`

**What:**  
A factory function `buildApp()` that creates and configures a Fastify instance: registers plugins (CORS, rate-limit, logger), sets up the global error handler, and registers all route plugins.

**Why we use a factory instead of a top-level `fastify` instance:**  
- Testability — `fastify.inject()` in tests creates a fresh app per test with no shared state.
- The factory can receive config overrides for testing (e.g., disable rate limiting).

**Plugins registered:**
- `@fastify/cors` — restricts origins to `config.app.frontendOrigin` (not `*` in production).
- `@fastify/rate-limit` — limits `/auth/*` and `/broadcasts/trigger` to prevent abuse.
- Pino logger — already built into Fastify; configured with `requestId` on every log line.

**Global error handler:**  
Catches all unhandled route errors and returns `{ error: { code, message, requestId } }` — no stack traces to the client in production. 5xx errors are sent to Sentry.

---

### Step 5 — `index.ts` (entry point + graceful shutdown)

**File:** `backend/src/index.ts`

**What:**  
Starts the Fastify server, initializes BullMQ workers, starts the scheduler, and registers `SIGTERM`/`SIGINT` handlers for graceful shutdown.

**Why graceful shutdown matters:**  
When a deployment happens, the old process receives `SIGTERM`. Without a shutdown handler, in-flight broadcast jobs get killed mid-execution, leaving Conversations stuck in `processing` or `in_progress` with no recovery path (until the stuck-conversation recovery worker runs). With graceful shutdown:
1. Stop accepting new HTTP requests.
2. Wait for in-flight BullMQ jobs to finish (drain workers).
3. Close Prisma connection.
4. Stop Fastify.

**Shutdown sequence:**
```
SIGTERM received
  → fastify.close()           // stop accepting new requests
  → broadcastWorker.close()   // drain in-flight jobs
  → conversationWorker.close()
  → reminderWorker.close()
  → prisma.$disconnect()
  → process.exit(0)
```

---

### Step 6 — `GET /health`

**File:** `backend/src/routes/health.ts`

**What:**  
A public endpoint that checks real connectivity to PostgreSQL and Redis and returns their status.

**Why:**  
- Deployment platforms (Render, Railway, etc.) use the health endpoint to decide if a deployment succeeded.
- On-call engineers use it to instantly confirm whether a 5xx spike is an app bug or infrastructure failure.
- Returns `503` if DB or Redis is unreachable — not just `200 { status: "ok" }` that doesn't reflect real health.

**Response shape:**
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "uptime": 123.4
}
```

**Check logic:**
- DB: `prisma.$queryRaw\`SELECT 1\``
- Redis: `redis.ping()`
- Either throws → `{ status: "degraded", db: "error" }` + HTTP 503

---

### Step 7 — `middleware/rbac.ts`

**File:** `backend/src/middleware/rbac.ts`

**What:**  
Two Fastify preHandler hooks:
- `authenticate` — verifies the `Authorization: Bearer <jwt>` header using `SUPABASE_JWT_SECRET`, loads the user from DB, attaches to `request.user`.
- `requireRole(...roles)` — checks that `request.user.role` is in the allowed set; returns 403 if not.

**Why two separate hooks:**  
Some routes only need authentication (any logged-in user), others need specific roles. Composing them gives flexibility:
```typescript
fastify.get('/auth/me', { preHandler: [authenticate] }, handler)
fastify.post('/users', { preHandler: [authenticate, requireRole('admin')] }, handler)
```

**Why we load the user from DB (not just trust the JWT):**  
The JWT contains the Supabase user ID. We look up the user in our `User` table to get their `role` and `active` status. This means:
- Deactivated users are rejected even if their JWT is still valid.
- Role changes take effect immediately (no need to wait for JWT expiry).

**JWT verification:**  
Uses `SUPABASE_JWT_SECRET` with the `jsonwebtoken` library — no Supabase SDK call on every request, just local crypto verification (fast).

---

### Step 8 — `GET /auth/me` + `POST /auth/logout` + `GET /integrations/status`

**File:** `backend/src/routes/auth.ts`

**What:**  
- `GET /auth/me` — returns the current user's profile + their server-derived scope (role, group IDs, manager partition IDs if viewer).
- `POST /auth/logout` — calls Supabase Admin API to revoke the session token.
- `GET /integrations/status` — returns the configuration status of all third-party integrations. Credentials are never exposed — only whether each integration is configured and working.

**Why `GET /auth/me` returns derived scope:**  
The frontend uses this on startup to know what to show (admin panel vs manager view vs viewer). The scope is computed server-side from DB joins — the client never sends `role` and we never trust it if it does.

**Why logout calls the server:**  
The Supabase JS client handles sign-out client-side, but calling our server allows us to audit the logout and — if needed in future — invalidate server-side sessions or tokens.

**`GET /integrations/status` response:**
```json
{
  "twilio": {
    "configured": true,
    "fromNumber": "+1555***7890"
  },
  "anthropic": {
    "configured": true
  }
}
```
- `configured: false` → frontend Integration section shows: *"Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in your deployment environment."*
- `configured: true` → shows masked `fromNumber` + optional "Send test SMS" button.
- `authToken` and `apiKey` are **never** included in this response — only existence and safe display fields.

---

## Phase 2 — CRUD APIs

Goal: all data management endpoints working with proper auth, validation, pagination, and scoped access.

---

### Step 9 — Users CRUD

**File:** `backend/src/routes/users.ts`

**What:**  
`GET /users`, `POST /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id`

**Why this order:**  
Read before write — we verify the DB integration and pagination work before testing mutations.

**Key details:**
- All list endpoints support `?page=1&limit=50` + filters (`role`, `groupId`, `active`, `search`). Max `limit` capped at 100 server-side.
- `POST /users` creates a Supabase Auth user (via Admin API) + inserts into our `User` table in a single operation. If Supabase succeeds but DB insert fails, we delete the Supabase user (compensating transaction).
- `DELETE /users/:id` soft-deactivates by default (`active=false`), not hard delete — open decision from `backend_plan.md` §22.
- Zod schema validates every request body before it touches the DB.

---

### Step 10 — Groups, GroupMembers, ManagerGroups CRUD

**File:** `backend/src/routes/groups.ts`

**What:**  
Groups CRUD + member management + manager↔group link management.

**Key details:**
- `DELETE /groups/:id` cascades to `GroupMember` and `ManagerGroup` via Prisma `onDelete: Cascade`.
- Adding a member checks the user exists before inserting.
- `GET /admin/setup-status` is implemented here — counts groups, links, memberships, and validates viewer coverage.

**Why setup-status matters:**  
New admins need a clear indicator of what's configured before broadcasts can work. An admin with 0 manager-group links will get no broadcasts even if schedules exist.

---

### Step 11 — Participants CRUD

**File:** `backend/src/routes/participants.ts`

**What:**  
`GET /participants`, `POST /participants`, `PATCH /participants/:id`, `DELETE /participants/:id`

Participants are users with `role = 'participant'`. They receive SMS broadcasts and may optionally have a platform login.

**Key details:**
- Manager scope: `GET /participants` for a manager returns only participants in their groups (via `ManagerGroup` → `GroupMember` join).
- `phone` must be E.164 format — validated by Zod regex (`/^\+[1-9]\d{1,14}$/`).
- `email` is optional on create. When email is added via `PATCH`, the backend creates a Supabase account and populates `supabase_id` — the participant can now log in.
- `smsOptedOut` is read-only via API — only the Twilio STOP/UNSTOP webhooks can change it.

---

### Step 12 — Questions + Schedules CRUD

**Files:** `backend/src/routes/questions.ts`, `backend/src/routes/schedules.ts`

**What:**  
Manager-scoped CRUD for questions and schedules, including their join tables (`ScheduleQuestion`, `ScheduleRecipient`).

**Key details:**
- On `POST /managers/:id/questions` and `PATCH`: compute the projected SMS bundle length for all questions attached to all schedules that use this question. If > `SMS_MAX_LENGTH` → 400 error. If > 80% → 200 with a `warning` field.
- Schedule `timezone` must be a valid IANA timezone string — validated with `Intl.supportedValuesOf('timeZone')` or the `luxon` library.
- `dayOfWeek` + `timeOfDay` stored as-is; scheduler interprets them in the schedule's timezone at fire time.

---

## Phase 3 — Broadcast Engine

Goal: schedules fire automatically, SMS is sent, conversations are created.

---

### Step 13 — SMS provider abstraction + `sms.service.ts`

**Files:**
- `backend/src/services/sms/sms.provider.interface.ts`
- `backend/src/services/sms/sms.factory.ts`
- `backend/src/services/sms/sms.service.ts`
- `backend/src/services/sms/providers/twilio.provider.ts`

**Architecture — interface + adapter + factory:**

The rest of the app never references Twilio directly. It only ever calls methods on `ISmsProvider`. Adding a future provider (Vonage, Plivo, AWS SNS) = one new file in `providers/` + two lines in the factory. Nothing else changes.

```
broadcast.service.ts
conversation.worker.ts      →  ISmsProvider  →  TwilioProvider (today)
webhooks.ts                                  →  VonageProvider  (future)
```

**`sms.provider.interface.ts` — the contract:**
```typescript
export interface ISmsProvider {
  sendSms(to: string, body: string): Promise<string>           // returns provider message ID
  validateWebhookSignature(req: FastifyRequest): boolean       // verify request is from provider
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload  // normalize to common shape
}

export type InboundSmsPayload = {
  from: string       // E.164 phone number
  body: string       // message text
  messageId: string  // provider's message ID (idempotency key)
}
```

`parseInboundWebhook` normalizes provider-specific webhook formats into one common shape. Twilio posts `From`/`Body`; Vonage posts `msisdn`/`text`. The webhook route always receives `InboundSmsPayload` regardless of provider.

**`sms.factory.ts` — provider selection:**
```typescript
export function createSmsProvider(): ISmsProvider {
  const provider = process.env.SMS_PROVIDER ?? 'twilio'
  switch (provider) {
    case 'twilio': return new TwilioProvider(config.twilio!)
    // future: case 'vonage': return new VonageProvider(config.vonage!)
    default: throw new Error(`Unknown SMS_PROVIDER: "${provider}"`)
  }
}
```

Called once in `index.ts` on startup. If `SMS_PROVIDER=twilio` but Twilio config is `null` → throws immediately with a clear error.

**`sms.service.ts` — bundle building (provider-agnostic):**  
`buildBundleMessage(participant, questions)` — assembles the SMS bundle and enforces the length limit. Has no knowledge of any provider.

```
Hey [name], quick check-in this week:
1. [question 1]
2. [question 2]
...
Just reply with your answers — no need to be formal!
```

Length enforcement:
- `> SMS_MAX_LENGTH` → throw `SmsTooLongError`. Broadcast worker catches this and marks the Conversation `failed`.
- `> 80% of SMS_MAX_LENGTH` → return `{ warning: true }` on the pre-validation API.

**`providers/twilio.provider.ts` — Twilio implementation:**  
Implements all three interface methods using the Twilio SDK. `sendSms` always sets `statusCallback`:

```typescript
await client.messages.create({
  to,
  from: config.twilio!.fromNumber,
  body,
  statusCallback: `${config.app.baseUrl}/webhooks/twilio`,
})
```

Error translation: Twilio SDK errors are mapped to domain errors (`TwilioDeliveryError`, `TwilioAuthError`) here — never leaked to callers.

**`docs/adding-sms-provider.md`** documents the full steps to add a future provider. See that file for the complete guide.

---

### Step 15 — `ai.service.ts`

**File:** `backend/src/services/ai.service.ts`

**What:**  
`extractAnswers(questions, reply)` — sends the participant's reply to Claude with structured output instructions and returns `[{ questionId, answer | null }]`.

**Why Claude for extraction:**  
Participants reply in natural language — not structured answers. Claude maps free text to the right questions using context, not keyword matching.

**Prompt:**  
```
You are extracting answers from an SMS reply sent by a hotel property manager.

Questions asked:
{{numberedQuestionList}}

Participant reply:
"{{reply}}"

Return JSON: { "answers": [{ "questionId": n, "answer": "string or null" }] }
Rules: match by number or context; null if missing or unclear; never invent.
```

**Why `null` instead of guessing:**  
If Claude isn't confident, it returns `null` for that question. We don't store the Answer row. This means the manager sees which questions went unanswered, not fabricated answers. The conversation stays open for the next cycle.

**SDK usage:**
```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: prompt }],
})
// parse JSON from response.content[0].text
```

---

### Step 16 — `broadcast.service.ts`

**File:** `backend/src/services/broadcast.service.ts`

**What:**  
`runBroadcast(scheduleId)` — the full orchestration: load schedule + questions + participants → create Broadcast → loop participants → build SMS → send → create Conversation + Message.

**Why a service layer (not inline in the worker):**  
- The worker is responsible for queue mechanics (retries, concurrency). The service is responsible for business logic. Keeping them separate means we can call `runBroadcast` from tests without a BullMQ queue.
- `POST /broadcasts/trigger` (manual trigger) calls the same service — no duplicate code.

**Participant loop logic:**
1. Skip if `smsOptedOut = true` → log skip.
2. Skip if `phone = null` → log skip (participant has no phone yet).
3. Supersede any open Conversation for this participant (set `status = superseded`, `failReason = SUPERSEDED_BY_NEW_BROADCAST`).
4. Build SMS bundle → enforce length (throws `SmsTooLongError` if over limit).
5. Create `Conversation` (`status = awaiting_reply`, `lastMessageAt = now`).
6. Call `sendSms` → get message ID.
7. Save `Message` (`role = ai`, `twilioSid = messageId`).
8. If `SmsTooLongError`: set Conversation `status = failed`, `failReason = SMS_TOO_LONG`, Sentry alert — continue loop for other participants.

**After loop:**  
Check if all Conversations are in terminal state (all failed for e.g. all opted-out) → set Broadcast `status = completed`.

---

### Step 17 — BullMQ queues + `broadcast.worker.ts`

**Files:** `backend/src/jobs/queue.ts`, `backend/src/jobs/broadcast.worker.ts`

**What:**  
- `queue.ts` — defines BullMQ queue instances (broadcast, conversation, reminder).
- `broadcast.worker.ts` — BullMQ worker that processes `run` jobs by calling `broadcast.service.ts`.

**Why BullMQ:**  
- Built-in retry with exponential backoff (`BROADCAST_RETRY_COUNT`, `BROADCAST_RETRY_DELAY_MS`).
- Concurrency control (`BROADCAST_CONCURRENCY` simultaneous workers).
- Job deduplication by job ID (secondary dedup — primary is the DB `@@unique([scheduleId, fireDate])`).
- Failed jobs are visible in Bull Dashboard (or via Redis CLI) for debugging.

**Worker retry config:**
```typescript
new Worker('broadcast', async (job) => {
  await runBroadcast(job.data.scheduleId)
}, {
  connection: redis,
  concurrency: config.broadcast.concurrency,
  settings: {
    backoffStrategy: (attempts) => Math.min(attempts * config.broadcast.retryDelayMs, 3_600_000),
  },
})
```

---

### Step 18 — `scheduler.ts`

**File:** `backend/src/jobs/scheduler.ts`

**What:**  
A `node-cron` job that runs every minute, queries all active schedules, checks if any are due to fire, and enqueues a broadcast job if so.

**Timezone-aware due check:**  
For each schedule, convert `now` to the schedule's timezone using `luxon`. Check if `dayOfWeek` matches and `timeOfDay` is within the current minute window (`HH:MM` to `HH:MM+1`).

**Dedup (secondary):**  
Before enqueuing, check if a Broadcast already exists for `(scheduleId, fireDate)`. If yes — skip. (The DB `@@unique` constraint is the primary guard; this is a fast pre-check to avoid unnecessary DB writes.)

**Why every minute:**  
Schedules fire at a specific `HH:MM`. Running the check every minute means maximum 1-minute delay between schedule time and first SMS. Running less frequently increases delay; running more frequently wastes resources.

---

### Step 19 — `reminder.worker.ts`

**File:** `backend/src/jobs/reminder.worker.ts`

**What:**  
Runs every 15 minutes via `node-cron`. Two jobs in one worker:

1. **Reminder ladder** — finds Conversations `WHERE status = awaiting_reply` and `lastMessageAt` is older than `CONVERSATION_REMINDER_INTERVAL_MINUTES`. If `remindersSent < CONVERSATION_REMINDER_COUNT`: send a nudge SMS, increment `remindersSent`, update `lastMessageAt`. If `remindersSent >= CONVERSATION_REMINDER_COUNT`: set `status = timed_out`, `failReason = NO_RESPONSE`, Sentry alert. Then check if all Broadcast's Conversations are terminal → set Broadcast completed.

2. **Stuck recovery** — finds Conversations `WHERE status = processing` and `lastMessageAt < now - CONVERSATION_STUCK_TIMEOUT_MINUTES`. Resets to `awaiting_reply`. Sends Sentry alert. This means a crashed conversation worker doesn't leave a Conversation stuck forever.

**Why both in one worker:**  
Both are time-based checks that run infrequently. No need for separate queue infrastructure.

---

## Phase 4 — Webhooks & Conversations

Goal: inbound SMS drives conversation forward; delivery failures are detected.

---

### Step 20 — `POST /webhooks/twilio`

**File:** `backend/src/routes/webhooks.ts`

**What:**  
Handles both inbound SMS and Twilio status callbacks from a single endpoint.

**Why return 200 immediately:**  
Twilio expects a 200 within 15 seconds. If our handler takes longer (DB query, Claude extraction), Twilio will retry the webhook, creating duplicate processing. We return 200 instantly and enqueue the real work.

**Branch logic:**
- Request has `Body` param → inbound SMS flow.
- Request has `MessageStatus` param (and no `Body`) → status callback flow.

**Inbound SMS flow (detailed):**
1. Signature validation — `twilio.validateRequest()` with `TWILIO_AUTH_TOKEN`. 403 if invalid. This prevents anyone from spoofing inbound messages.
2. `STOP` body → `User.smsOptedOut = true`, close open Conversation. Done.
3. `UNSTOP` body → `smsOptedOut = false`. Done.
4. Idempotency check: `Message WHERE twilioSid = SmsSid` exists → skip (Twilio is retrying).
5. Find open Conversation by `User.phone = From`.
6. Atomic ping-pong lock:
   ```sql
   UPDATE conversations SET status = 'processing'
   WHERE id = ? AND status = 'awaiting_reply'
   ```
   - 1 row updated → save Message, enqueue `conversation` job.
   - 0 rows updated → log to `InboundAuditLog`. If Conversation is in terminal state → send courtesy SMS.

**Status callback flow:**  
Find Message by `twilioSid`. Set Conversation `status = failed`, `failReason = TWILIO_DELIVERY_FAILED`. Sentry alert.

---

### Step 21 — `conversation.worker.ts`

**File:** `backend/src/jobs/conversation.worker.ts`

**What:**  
Processes a conversation job: concatenates participant messages, calls Claude to extract answers, stores results, and either completes the conversation or sends an acknowledgment.

**Why concatenate messages:**  
Some phones split long replies into multiple SMS segments. Twilio delivers each segment as a separate webhook. By concatenating all `role=participant` messages since the last `role=ai` message, we process the full reply even if it arrived in parts.

**Flow:**
1. Load Conversation + questions + all Messages since last AI message.
2. Concatenate participant message bodies.
3. Call `ai.service.extractAnswers(questions, combinedText)`.
4. Store confident Answer rows (`answer !== null`).
5. If answers found:
   - Set `Conversation.status = completed`, `completedAt = now`.
   - Check if all Broadcast's Conversations are terminal → Broadcast `status = completed`.
6. If 0 answers (participant replied but Claude found nothing):
   - Send acknowledgment: `"Got it! Please reply with your answers when ready."`
   - Save as `Message(role=ai)`.
   - Reset Conversation → `awaiting_reply` (ping-pong maintained, participant's turn again).

---

### Step 22 — `cleanup.worker.ts`

**File:** `backend/src/jobs/cleanup.worker.ts`

**What:**  
Runs nightly via `node-cron`. Deletes (or soft-deletes) Conversations older than `CONVERSATION_RETENTION_DAYS` days. 0 = keep forever (default).

**Why:**  
GDPR and storage cost. Hotels accumulate thousands of conversations per year. Old data has no business value but carries compliance risk.

**Note:**  
Hard vs soft delete is an Open Decision (`backend_plan.md` §22). The worker is structured so switching from `deleteMany` to `updateMany({ deletedAt: now })` is a one-line change.

---

## Phase 5 — Frontend Cutover

Goal: `AI_Reporter.html` calls the real API instead of localStorage.

---

### Step 23 — Feature flag + domain-by-domain migration

**What:**  
Add `const USE_API = false` at the top of `AI_Reporter.html`. Flip to `true` per domain as each API slice is verified.

**Migration order:**
1. Auth (`GET /auth/me`, `POST /auth/logout`) — Supabase JS client handles sign-in.
2. Users + Groups + Manager Groups.
3. Participants.
4. Questions + Schedules.
5. Conversations / history reads.
6. Broadcast trigger + status polling.
7. Cleanup: delete all `*_SEED` constants, localStorage keys, demo-only UI.

**Why one domain at a time:**  
Rolling back is trivial — flip `USE_API` back to `false` for that domain. If we cut everything at once, a bug in one area takes down the whole app.

**Rules during cutover:**
- JWT stored in memory only (not localStorage, not sessionStorage).
- Every API error surfaces a visible user-facing message — no silent failures.
- Empty states handled explicitly (e.g., "No participants yet" not a blank table).

---

## Phase 6 — Production Hardening

Goal: the system is safe, observable, and recoverable before go-live.

---

### Step 24 — Supabase RLS policies

**What:**  
Write Row Level Security policies on all tenant-scoped tables in Supabase.

**Why both RLS + route-layer RBAC:**  
Route layer is the first line of defense (fast, flexible). RLS is defense in depth — even if a bug in our code queries the wrong data, Postgres itself rejects the read. Two independent layers means a bug in one doesn't become a data breach.

**Example RLS policy for `Conversation`:**
```sql
CREATE POLICY "managers_see_own_conversations" ON conversations
  FOR SELECT USING (
    broadcast_id IN (
      SELECT b.id FROM broadcasts b
      JOIN schedules s ON s.id = b.schedule_id
      WHERE s.manager_id = auth.uid()
    )
  );
```

---

### Step 25 — Rate limiting, CORS, and security headers

**What:**  
- `@fastify/rate-limit` on `/auth/*` (10 req/min) and `/broadcasts/trigger` (5 req/min).
- CORS restricted to `FRONTEND_ORIGIN` per environment.
- `@fastify/helmet` for security headers (CSP, HSTS, etc.).

**Why rate limits on those endpoints specifically:**  
- `/auth/*` — brute-force protection.
- `/broadcasts/trigger` — prevent accidental or malicious bulk-trigger that sends thousands of SMS.

---

### Step 26 — CI/CD pipeline

**What:**  
GitHub Actions workflow (or platform-native) that on every push to `main`:
1. `npm run build` — TypeScript compile check.
2. `vitest run` — full test suite.
3. `prisma migrate deploy` → staging DB.
4. Deploy to staging.
5. Run smoke test against staging health endpoint.
6. On manual approval → deploy to prod.

**Why staging before prod:**  
Every `backend_plan.md` §17 production-ready checkbox that references "staging" needs this pipeline to be verifiable.

---

### Step 27 — Sentry + log aggregation

**What:**  
- Sentry SDK wired up in `app.ts` error handler and in worker `onFailed` callbacks.
- Log aggregation (Logtail, Datadog, or platform native) configured to ingest Pino JSON output.

**Alerts configured:**
- Failed broadcast (any broadcast that exhausts all retries).
- Stuck conversation (any recovery event in `reminder.worker.ts`).
- 5xx spike (> 5 errors/min).
- Health endpoint red.

---

### Step 28 — Backup + restore drill

**What:**  
- Verify Supabase point-in-time recovery is enabled on prod.
- Perform a restore from the most recent backup into a staging clone.
- Verify the restored data is complete and the API works against it.

**Why drill before go-live:**  
A backup that has never been restored is an untested backup. The drill proves recovery works and gives the team a runbook they've actually executed.

---

### Step 29 — Rollback drill

**What:**  
- Deploy a test change to staging.
- Revert it using the hosting platform's rollback UI.
- Verify the service returns to the previous state without manual intervention.

---

## Definition of done

Before go-live, every checkbox in `backend_plan.md` §23 must be true.  
Every UI/UX signoff gate (§18) must pass with evidence.

---

*Update this file as steps complete — check off each step as implemented and reviewed.*
