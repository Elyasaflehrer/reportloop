# AI Reporter — Master Production Readiness Plan

> **Single source of truth for this repo.** Aligns frontend cutover, backend, security, ops, UI/UX signoff, and launch.  
> **Related detail:** See `backend_plan.md` for expanded Fastify/Prisma/BullMQ design (this file captures decisions + gates + how to ship).

---

## Status

| Field | Value |
|-------|--------|
| **Mode** | Planning |
| **Target** | Enterprise-grade SaaS: real auth, real data, scheduled broadcasts, Twilio, AI extraction, observability |
| **Frontend** | `AI_Reporter.html` — today localStorage/mock; cut over to API then remove mock paths |
| **Backend direction** | PostgreSQL (Supabase) + Supabase Auth + RLS + TypeScript service layer (Fastify or Edge Functions — see Open Decisions) |
| **Demo data** | **Non-negotiable:** all `*_SEED` / demo constants in the HTML bundle are presentation-only and **deleted** at cutover. Schema and APIs follow **business domain**, not seed shape. No demo data migration. |

---

## 1) Product goal

Ship a production system where:

- **Auth:** real identities, sessions, and role enforcement (not client-trusted payloads).
- **Data:** multi-tenant isolation; manager/viewer/participant scopes derived from relationships, not ad-hoc lists in the browser.
- **Operations:** schedules fire broadcasts; Twilio sends/receives SMS; AI extracts structured answers; full audit trail of messages and outcomes.
- **Quality:** UI/UX signoff gates pass with evidence before go-live.
- **Ops:** environments, secrets, backups, rollback, monitoring, and runbooks exist.

---

## 2) Architecture (recommended baseline)

### 2.1 Stack (default recommendation)

| Layer | Choice | Notes |
|-------|--------|--------|
| **Database** | PostgreSQL via Supabase | RLS for tenant isolation |
| **Auth** | Supabase Auth | JWT/session; **one canonical auth path** (see §5.1) |
| **API / jobs** | TypeScript — Fastify + Prisma **or** Supabase Edge Functions | Pick before Phase 3; see Open Decisions |
| **Queue / schedule** | Start with cron + DB; add **BullMQ + Redis** when concurrency/retry complexity demands it | `backend_plan.md` assumes BullMQ early — acceptable if team commits to Redis ops |
| **SMS** | Twilio (platform account) | Webhook signature validation mandatory |
| **AI** | Anthropic (server-side only) | Structured extraction; no keys in browser |
| **Validation** | Zod (or equivalent) on all inputs | Consistent error shape |
| **Logging** | Structured JSON (e.g. Pino) + **requestId** on every line | Staging + prod |
| **Errors** | Sentry (or equivalent) | Alerts on broadcast failure, 5xx spikes |
| **Secrets** | Env / secret manager only | Never localStorage, never client |

### 2.2 Non-negotiables

- No secrets in browser or localStorage.
- No localStorage as source of truth for business data after cutover.
- No denormalized “who can see what” as the **authoritative** store — derive scope with joins (groups, manager–group links, memberships).
- Twilio **STOP/UNSTOP** (or regional equivalent) handled and enforced before sends.
- All list endpoints **paginated** in production (no unbounded reads).

### 2.3 Canonical conversation product shape (align UI + backend)

Pick **one** model and implement end-to-end (avoid mixing with old multi-turn demo UI):

**Recommended (matches `backend_plan.md`): single outbound bundle + one reply + AI extraction**

- One SMS contains numbered questions; employee replies once; Claude returns structured JSON (answers + confidence).
- Enforce **SMS length** before send; fail closed with clear reason if over limit; validate at question save time (warn near limit, block over limit).
- **Concurrency:** atomic transition (e.g. `awaiting_reply` → `processing`) so duplicate inbound messages do not double-process; log out-of-turn to audit table; optional courtesy SMS if session closed.
- **Reliability:** reminder ladder for no-reply; timeout to `timed_out`; stuck `processing` recovery; supersede old open conversation when a new broadcast for same employee starts.
- **Retention:** configurable retention job; hard vs soft delete is an open product decision.

If you instead choose multi-turn SMS, rewrite §7 and all tests — do not leave the plan ambiguous.

---

## 3) Environments

Use **three** isolated environments:

| Env | Purpose | DB / Auth | Twilio | Notes |
|-----|---------|-----------|--------|--------|
| **dev** | Local + integration | Dev Supabase | Sandbox / test | Fast iteration |
| **staging** | Pre-prod gate | Staging Supabase | Test number | Must mirror prod config; run full checklist before prod |
| **production** | Live | Prod Supabase | Live numbers | RLS + alerts + backups on |

No shared credentials across envs.

---

## 4) Data model (conceptual)

Entities (names may map to Prisma tables or SQL migrations):

- **users** — staff roles: admin, manager, viewer; link to Supabase `auth.users` via stable external id.
- **groups**, **group_members** — users and/or employees in groups.
- **manager_group_links** — which manager partition covers which groups (source of roster and viewer derivation).
- **employees** — property contacts; unique phone where required for SMS routing.
- **questions**, **schedules**, **schedule_recipients**, **schedule_questions**.
- **broadcasts**, **conversations**, **messages**, **answers** (or equivalent normalized extraction store).
- **integrations** — non-secret metadata only (e.g. Twilio from number / messaging service SID pattern); tokens never in DB.

**Employees and managers:** no “magic `managerId` on employee” as sole scope; scope through group graph (as in current product intent).

**Viewer access:** derived: viewer user → group memberships → manager_group_links → allowed manager partitions (and active partition for UI switcher).

---

## 5) Auth and authorization (production clarity)

### 5.1 One canonical auth path (resolve early)

Choose **one** and document it in the runbook:

- **Option A (recommended):** Browser uses **Supabase client** for sign-in; API receives `Authorization: Bearer <jwt>`; server verifies JWT with Supabase JWKS/secret; **no** custom `POST /auth/login` that duplicates password handling.
- **Option B:** Server-hosted login that calls Supabase Admin API — only if you explicitly need it; then rate-limit and audit heavily.

**Rule:** never trust `role` or `managerPartitionId` from the client payload alone; resolve from DB + token subject.

### 5.2 Authorization layers

1. **RLS** on all tenant-scoped tables (defense in depth).
2. **Route / function middleware** — `requireRole`, manager-id match, viewer partition allowlist.
3. **Never** rely on UI hiding buttons as security.

### 5.3 Security checklist (must ship)

- Twilio webhook **signature validation** on every inbound request.
- Rate limits on auth, webhook, and manual trigger endpoints.
- CORS allowlist per environment.
- Structured errors without leaking secrets or stack traces to clients in prod.
- **GDPR / privacy** — post-launch track: erasure, export, retention policy, SMS consent copy (see `backend_plan.md` §22 pattern).

---

## 6) API / function surface (v1 — indicative)

Base path example: `/api/v1` (exact prefix is an implementation detail).

**Session / identity**

- `GET /auth/me` or `GET /me` — current user + **server-derived** scope (not raw client role fields).

**Admin**

- Users CRUD + filters + pagination (`role`, `group`, `search`, `active`, …).
- Groups CRUD; group members; manager–group links.
- Optional: `GET /admin/setup-status` — aggregated setup metrics (groups, links, memberships, viewer coverage).

**Manager**

- Questions and schedules CRUD scoped to own manager partition (admin override if product requires).

**Reads**

- Broadcasts list/detail (scoped).
- Conversations list/detail/messages (+ extracted answers if separate resource).

**Writes / runtime**

- `POST /broadcasts/trigger` (admin or controlled role).
- `POST /broadcasts/:id/retry` (admin) for failed runs.
- `POST /webhooks/twilio` — validate, acknowledge quickly, async process.

**Health**

- `GET /health` — DB reachable; Redis reachable if used; dependency smoke.

**Pagination:** every list `GET` supports `page` / `limit` (and max cap) before prod.

---

## 7) Broadcast and conversation runtime (summary)

Implement the flow chosen in §2.3. Minimum production behaviors:

- **Idempotent** schedule firing + dedupe window (e.g. no duplicate broadcast for same schedule window).
- **Timezone-aware** schedule evaluation (manager or schedule timezone stored and used consistently).
- **Failure taxonomy:** `SMS_TOO_LONG`, `NO_RESPONSE`, provider errors — persisted, visible to admin, alert-worthy.
- **Retries:** configurable for workers; manual retry endpoint for ops.
- **Graceful shutdown:** drain in-flight jobs on deploy (if using queue workers).

---

## 8) Frontend migration (`AI_Reporter.html`)

### 8.1 Strategy

- Feature flag **`USE_API`** (or equivalent): migrate **one domain at a time**.
- After each domain: **acceptance tests** + smoke in staging; then delete the old code path for that domain.
- **Do not** require parity with demo seed data — parity with **real** API contracts and empty states.

### 8.2 Suggested order

1. Auth/session hydration from API + Supabase.
2. Users, groups, manager–group links.
3. Employees (if separate from users in your final model).
4. Questions and schedules.
5. Read paths: broadcasts, conversations, messages, logs.
6. Twilio integration settings (server-stored metadata only).
7. Remove all `*_SEED`, localStorage migrations, and demo-only UI (e.g. unrestricted “switch user” must not exist in prod builds).

### 8.3 Serving the app

- Production: serve static frontend from CDN or same origin as API; **do not** use React **development** UMD bundles in prod (build step / pinned prod assets).

---

## 9) UI/UX production signoff gates

**Policy:** any failed **critical** gate = **NO-GO**.

| Gate | Criteria |
|------|-----------|
| **A — Responsiveness** | No overlap/clipping at 1366 / 1280 / 1024 / 768 and 100 / 125 / 150% zoom |
| **B — Keyboard** | All critical tasks completable; visible focus; modals: trap, Escape, focus return |
| **C — Accessibility** | Programmatic labels; live regions for dynamic feedback; correct table/grid semantics |
| **D — Feedback** | No silent failures; destructive actions confirmed; success/error always clear |
| **E — Consistency** | Patterns consistent across admin, manager, history |

Track evidence (screenshots, short screen-reader notes, checklist sign-off). Optional: repo scripts `uiux_signoff_check.py`, `uiux_viewport_sweep.py` as **helpers**, not substitutes for human gate C.

---

## 10) Testing and verification (minimum matrix)

**Unit:** services (SMS builder length, AI extraction parsing, scope helpers).

**Integration:** docker-compose (or CI) — seed smoke DB → login → CRUD → trigger broadcast → webhook simulation → conversation completes.

**Security:** RLS tests per role; forbidden cross-manager reads; participant isolation.

**E2E (staging):** real Twilio sandbox + ngrok-style webhook URL; STOP/UNSTOP; timezone firing; pagination under load.

**Load:** N concurrent broadcasts ( tune N to product SLO ); queue depth and error rate within bounds.

**Chaos / ops:** SIGTERM during job; Redis restart; DB failover drill.

---

## 11) Phased execution (high level)

| Phase | Focus | Exit signal |
|-------|--------|-------------|
| **1 — Foundation** | Supabase projects, schema, RLS baseline, auth path, env/secrets, health, minimal smoke seed | Auth + health green in dev |
| **2 — Core CRUD** | Users, groups, links, employees, questions, schedules + pagination + errors | Staging CRUD demo with RLS tests green |
| **3 — Runtime** | Scheduler/trigger, broadcast creation, conversation lifecycle, dedupe/supersede | Triggered run creates correct rows |
| **4 — Twilio + AI** | Outbound, webhook, extraction, reminders, timeouts, STOP | End-to-end SMS loop in staging |
| **5 — Frontend cutover** | `USE_API` per domain; remove localStorage authority; delete demo | No business data in localStorage |
| **6 — Hardening + launch** | Sentry, log aggregation, rate limits, backup/restore drill, rollback drill, UI gates, prod deploy | Section 12 checklist all true |

Week numbers are estimates — adjust to team size.

---

## 12) Definition of production ready (checklist)

Ship only when **all** applicable items are true:

- [ ] Backend is authoritative for all business domains; frontend has no mock authority paths.
- [ ] All `*_SEED` and demo-only code removed from production bundle.
- [ ] Auth: canonical path documented; JWT verified on every protected call; roles from DB, not client trust.
- [ ] RLS + server RBAC verified by automated tests.
- [ ] Full broadcast loop works in staging: schedule → SMS → inbound → extract → persist → terminal state correct.
- [ ] SMS length rules enforced at send and at question/schedule edit time.
- [ ] STOP/UNSTOP (or equivalent) enforced; no sends to opted-out numbers.
- [ ] Failed broadcasts visible; retry automatic where designed; manual retry available.
- [ ] Retention policy implemented and job tested.
- [ ] Structured logs + **requestId** in staging/prod; Sentry (or equivalent) alerting live.
- [ ] `GET /health` reflects real dependencies.
- [ ] All UI/UX gates A–E pass with evidence.
- [ ] Backup + **restore drill** completed on prod-like data.
- [ ] Rollback path tested from staging (deploy revert + migration strategy).
- [ ] No secrets in code, DB, or browser; CORS and rate limits correct per env.
- [ ] Pagination on all list endpoints; no unbounded production queries.
- [ ] Schedule timezone behavior verified.
- [ ] Graceful shutdown verified if workers/queues are used.

---

## 13) Operations and runbooks

- **On-call:** who gets paged for broadcast failures, webhook errors, health red.
- **Runbook:** disable schedules globally; rotate Twilio/Anthropic keys; reprocess dead-letter conversations.
- **Migrations:** forward-only in prod where possible; documented rollback for breaking schema.
- **CI/CD:** lint, typecheck, tests, migration apply to staging, then promote (hosting TBD — see Open Decisions).

---

## 14) Rollback (summary)

| Scenario | Action |
|----------|--------|
| Bad API deploy | Revert to previous image/commit; feature flag per domain if still in migration |
| Bad migration | Roll back migration per tool policy; restore from backup if data corrupted |
| Twilio / AI outage | Disable triggers or schedules; communicate; fix keys/webhooks |

Rollback must be **rehearsed in staging** before first prod cut.

---

## 15) Day 1–2 execution (concrete)

**Day 1:** Create dev Supabase project; draft ERD + RLS matrix; implement schema v0 + `GET /health` + `GET /me` with verified JWT; minimal smoke seed.

**Day 2:** Users + groups + manager-links API (read path first, then writes); first `USE_API` slice in UI; file issues for any contract mismatch.

---

## 16) Open decisions (track until resolved)

| Topic | Options | Notes |
|-------|---------|--------|
| API runtime | Supabase Edge Functions only vs **Fastify + Prisma** (`backend_plan.md`) vs hybrid | Hybrid is valid: Edge for webhooks, Fastify for heavy jobs |
| Queue | Cron-only first vs **BullMQ + Redis** from week 1 | Redis is ops cost; omit until load/retry story needs it |
| Auth entry | Supabase client-only vs server login | Pick §5.1 and stick to it |
| Hosting / CI | Render, Railway, Fly, GCP, etc. | Lock before Phase 6 |
| Log sink | Platform logs vs Datadog/Logtail | Lock before Phase 6 |
| Retention | Hard delete vs soft delete | Affects compliance and queries |
| Voice | SMS-only vs voice later | Product scope |

---

## 17) References inside this repo

- **`backend_plan.md`** — detailed Fastify/Prisma/BullMQ schema, workers, webhook flow, test matrix (use as engineering appendix).
- **`uiux_signoff_report.md`** — current UI gate findings (update as gates pass).
- **`uiux_signoff_check.py`**, **`uiux_viewport_sweep.py`** — optional automation helpers for gates A/B partial coverage.

---

## 18) Document control

- Update **Status** and checkboxes in §12 as implementation progresses.
- When `backend_plan.md` and this file diverge, **this file** states intent and gates; **backend_plan.md** carries deep implementation detail — reconcile explicitly when decisions change.

---

*End of master plan.*
