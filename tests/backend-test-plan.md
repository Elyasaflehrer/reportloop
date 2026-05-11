# Backend Test Plan

> **Status:** Brainstorm phase. Scenarios listed. Two-tier strategy decided.
> Triage + infrastructure setup pending.
>
> **Scope:** Full backend regression suite — all features.
> **Independence:** Tests do NOT require the frontend. Backend HTTP/service-level only.

This is a working document. As scenarios are written and pass, tick the checkbox.
As we discover missing scenarios, add them.

---

## How to read this list

Each scenario has:
- **ID** — `category.scenario` (e.g., `3.5`) for unambiguous reference
- **Label** — what the scenario covers
- **Tier** — `CI` (every commit) / `E2E` (pre-prod release gate) / both
- **Status** — `[ ]` not yet written, `[~]` written but not green, `[x]` passing

`*needs verification*` markers flag scenarios where we're not sure the endpoint
or behaviour exists today — those get a code-check before they get a test.

Categories are organised by feature area, not code file.

---

## Test architecture — two-tier strategy

After several rounds of brainstorming we landed on a split: **most tests run on
every commit (cheap, fast, free); a small canonical e2e set runs before
releases (expensive, slow, real)**. This is the standard professional split.

### Tier 1 — CI (every commit)

| Property | Choice |
|---|---|
| **DB** | Real Postgres — dedicated test database, truncated per test |
| **Redis** | Real Redis — test-namespaced queue names |
| **Twilio** | Mocked at `ISmsProvider` interface boundary |
| **Twilio webhooks (inbound)** | Locally signed Twilio-format payloads (we own `auth_token`, can compute the same HMAC Twilio does) |
| **Auth** | Supabase JWTs signed locally with the real `SUPABASE_JWT_SECRET` |
| **Worker** | Handlers called directly; BullMQ retry/dispatch tested in a few targeted tests |
| **Runtime target** | < 5 minutes for full suite |
| **Cost** | $0 |
| **Realism** | ~95% — everything except Twilio's actual network behavior |

**Proves:** Code is correct. Refactors don't break logic. Edge cases handled.
RBAC works. DB queries are right. All inbound webhook edge cases handled.

**Doesn't prove:** Real Twilio actually delivers SMS. Real Twilio webhook
signatures pass our validation. Real network/timing issues.

### Tier 2 — Pre-production (release gate)

| Property | Choice |
|---|---|
| **DB** | Real (staging DB or dedicated e2e DB) |
| **Redis** | Real |
| **Twilio** | Real — actual SMS sent, actual webhooks received |
| **Webhooks** | Twilio's real servers fire them at our public URL (ngrok or staging) |
| **Auth** | Real Supabase users in a test project, OR locally-signed |
| **Worker** | Real BullMQ workers running, real queue traffic |
| **Runtime target** | 30–45 minutes for ~15 canonical scenarios |
| **Cost** | ~$0.30–$1 per full run + ~$2/month for test numbers |
| **Realism** | 100% |

**Proves:** Twilio integration works end-to-end. Signature validation works
against real Twilio signatures. SMS actually delivers. The platform is
production-ready.

**Run when:**
- Before pushing a release to production
- After significant Twilio-related changes
- Periodically to catch external-API drift

### Trigger matrix

| Trigger | Tier 1 | Tier 2 |
|---|---|---|
| Every commit / PR | ✅ | — |
| Merge to main | ✅ | — |
| Pre-release (manual) | ✅ | ✅ |
| Pre-deploy to production | ✅ | ✅ |
| Nightly scheduled (optional) | — | ✅ (catches Twilio-side changes) |

---

## Tier 2 — pre-prod canonical scenarios (~15)

These are the **release-gate scenarios** running with everything real.
Hand-picked to cover the major flows; not a copy of the 184. If this set ever
grows past ~25, we've drifted off-strategy.

The actual list lives in the **"Real-cost queue"** section below — the single
gathered place for every test that costs real Twilio money. The other ~169
scenarios from the 184 list are **Tier 1 (CI) only**.

---

## Cost tag — what runs now vs later

Independent of the CI/E2E tier split, every scenario gets a **cost** tag that
controls whether we run it today.

| Tag | Meaning | Run now? |
|---|---|---|
| `free` | Hits only local services (Postgres, Redis, Supabase local). No external paid API. | ✅ yes |
| `mock-pending` | Would call real Twilio today; cheap to unlock once the `ISmsProvider` mock is wired. | ❌ defer — but unblock by building the mock |
| `real-only` | Fundamentally needs real Twilio (Tier 2 E2E only). | ❌ defer to release-gate runs |

**Rule:** only `free` scenarios run on every commit until the Twilio mock is in.
The `mock-pending` count is the backlog the mock will unlock — watch it as a
signal of how much value building the mock buys.

Each scenario below has its tag appended in italics, e.g.:
- [ ] **1.2** Create manager user — triggers phone provisioning  *(mock-pending)*
- [ ] **1.3** Create viewer user  *(free)*

---

## Mock-backed queue — test before continuing

The scenarios below are the ones that previously would have cost real Twilio
money to run (each manager creation buys a number; each broadcast sends paid
SMS). The `ISmsProvider` mock (see `backend/docs/mock-sms-provider.md`)
removes that cost — every entry here can now run in CI for $0.

This is the focused next batch: get these green before moving on to other
work. The list is exactly the `mock-pending` set — no `free` (those already
run today) and no `real-only` (those stay in Tier 2 / E2E).

### Cat 1 — User CRUD
- [x] **1.2** Create manager user — triggers phone provisioning
- [x] **1.23** Soft-delete a manager → `assignedPhone` stays on the soft-deleted record

### Cat 2 — Role transitions
- [x] **2.1** viewer → manager → triggers provisioning, gets number
- [ ] **2.3** manager → viewer → demotion cleanup (schedules + questions soft-deleted, ManagerGroup links removed, `assignedPhone` stays)
- [ ] **2.4** manager → admin → demotion cleanup runs
- [x] **2.5** Demote then re-promote → reclaims own `assignedPhone` (Step 1 of provisioning), no provider call
- [ ] **2.6** Promote viewer to manager when at `PHONE_LIMIT_REACHED` → manager created with no number, warning logged (does NOT throw)
- [ ] **2.7** Concurrent role-change attempts → last write wins
- [ ] **2.8** participant → manager (open question: is this transition allowed?)
- [ ] **2.10** admin → manager → triggers provisioning
- [ ] **2.11** Provisioning fires for both `POST /users` create-as-manager AND `PATCH` role-to-manager paths

### Cat 3 — Phone provisioning
- [ ] **3.1** First manager creation → provider API called, number bought
- [ ] **3.2** Second manager, no idle numbers → provider API called again
- [x] **3.3** New manager when an idle number exists → number recycled, no provider call
- [ ] **3.4** Manager re-promoted → reclaims their own number (Step 1, no provider call)
- [x] **3.5** Hit `PHONE_MAX_NUMBERS` → 409 `PHONE_LIMIT_REACHED`
- [ ] **3.6** Provider API fails (network / auth error) → 502 `PROVISION_FAILED`
- [ ] **3.7** Concurrent provisioning of same idle number → only one wins (transaction), second falls through
- [ ] **3.8** Manual `POST /users/:id/provision-number` — admin for any manager → success
- [ ] **3.9** Manual provision — manager for self → success

### Cat 4 — Schedule lifecycle
- [ ] **4.1** Create schedule for manager with phone → active OK
- [ ] **4.2** Create with `active: true` for manager without phone → forced `active: false` + `warning: 'PHONE_NUMBER_REQUIRED'`
- [ ] **4.3** Activate via PATCH for manager without phone → 422 `PHONE_NUMBER_REQUIRED`
- [ ] **4.4** Activate via PATCH for manager with phone → succeeds
- [ ] **4.5** Update non-active fields (label, time, etc.)
- [ ] **4.6** Soft-delete schedule
- [ ] **4.7** Soft-deleted schedule → broadcasts don't fire, doesn't appear in cron lookup
- [ ] **4.8** Schedule references soft-deleted question (open question: filter excluded?)
- [ ] **4.9** `GET /schedules` — admin sees all
- [ ] **4.10** `GET /schedules` — manager sees only own
- [ ] **4.11** `GET /schedules` — viewer sees viewable managers' schedules
- [ ] **4.12** `GET /schedules/:id` — happy path
- [ ] **4.13** `GET /schedules/:id` — RBAC violations → 403
- [ ] **4.18** Attach `scheduleRecipient` (subset mode) → only those participants targeted
- [ ] **4.19** Attach `scheduleQuestion` → broadcast sends those questions

### Cat 5 — Broadcast lifecycle
- [ ] **5.1** Manual trigger by admin → fires, conversations created
- [ ] **5.2** Manual trigger by manager (own schedule) → fires
- [ ] **5.3** Manual trigger by manager (other's schedule) → 403
- [ ] **5.4** Schedule cron fires at scheduled time → broadcast queued
- [ ] **5.5** Broadcast for manager with no `assignedPhone` → blocked at guard, error logged, no SMS sent
- [ ] **5.6** Broadcast skips opted-out participants
- [ ] **5.7** Broadcast skips participants with no phone
- [ ] **5.8** Two managers, same participant → both conversations created, no cross-routing on reply
- [ ] **5.9** Broadcast with `recipientMode: 'all'` → all group members targeted
- [ ] **5.10** Broadcast with `recipientMode: 'subset'` → only `ScheduleRecipient` rows targeted
- [ ] **5.11** Broadcast deduplication — same `scheduleId` + `fireDate` → uniqueness constraint
- [ ] **5.12** Broadcast retry on transient SMS failure (BullMQ retries)
- [ ] **5.13** `triggeredBy` field set correctly on manual trigger; null on cron-fired

### Cat 6 — Inbound webhook (message handling)
- [ ] **6.1** Happy path — participant replies → message saved, conversation locked, `conversationQueue` enqueued
- [ ] **6.4** Duplicate Twilio SID (Layer 2 idempotency) → log.warn + return
- [ ] **6.8** Manager soft-deleted but number still active → log.info + return
- [ ] **6.9** No open conversation for participant + manager → log.warn + return
- [ ] **6.10** Out-of-turn (status: processing) → audit log `OUT_OF_TURN`
- [ ] **6.11** Out-of-turn (status: completed) → audit log `SESSION_COMPLETED`
- [ ] **6.12** Out-of-turn (status: timed_out) → audit log `SESSION_TIMED_OUT`
- [ ] **6.13** Out-of-turn (status: failed) → audit log `SESSION_FAILED`
- [ ] **6.14** Out-of-turn (status: superseded) → audit log `SESSION_SUPERSEDED`
- [ ] **6.15** Body too long (P2000) → log.warn + return, no retry
- [ ] **6.16** Manager A demoted, number reassigned to Manager B, participant replies → falls to "no open conversation"
- [ ] **6.17** Concurrent replies to same conversation → only one acquires lock, other audited as `OUT_OF_TURN`

**Total: 60 scenarios** (Cat 1: 2, Cat 2: 9, Cat 3: 9, Cat 4: 15, Cat 5: 13, Cat 6: 12)

---

## Real-cost queue — tests that still cost real money

The scenarios below are the **only** tests in the suite that still cost real
money to run — they fundamentally need real Twilio (real number purchase,
real SMS sent, real webhooks fired by Twilio's servers). Everything else
runs free against the mock or local services.

Run this queue **only before a production release**, not on every commit.
Cost is ~$0.30–$1 per full run plus ~$2/month for the two test numbers.

These are the canonical Tier 2 set — keep this gathered list as the single
source of truth. If the count grows past ~25, we've drifted off-strategy.

- [ ] **E2E.1** Provision a real Twilio number for a manager (real purchase via Twilio API)
- [ ] **E2E.2** Re-promote a demoted manager → reclaims own number, no Twilio call
- [ ] **E2E.3** Hit `PHONE_LIMIT_REACHED` with a low cap — UI shows correct error
- [ ] **E2E.4** Activate schedule → fire broadcast → real SMS delivered to participant phone
- [ ] **E2E.5** Manager has no number → broadcast blocked, no SMS sent
- [ ] **E2E.6** Real participant reply → message saved, AI processes, conversation completes
- [ ] **E2E.7** Real `STOP` keyword → opt-out + active conversations failed (verify in real DB)
- [ ] **E2E.8** Real `START` keyword → opted back in
- [ ] **E2E.9** Reminder cron sends real follow-up SMS to a stale conversation
- [ ] **E2E.10** Real status callback for failed delivery (use known-bad number) → conversation marked `failed`
- [ ] **E2E.11** Two managers + one participant → both broadcasts deliver, replies route correctly
- [ ] **E2E.12** Out-of-turn reply (text twice quickly) → second reply audited as `OUT_OF_TURN`
- [ ] **E2E.13** Real MMS rejected at gate (send actual MMS via real device)
- [ ] **E2E.14** Webhook signature validation against real Twilio signature
- [ ] **E2E.15** Full lifecycle: broadcast → reply → AI processing → completion → delivery callback

**Total: 15 scenarios** (real-cost only — everything else in the plan is free)

---

## Code organization

```
backend/
├── test/                          ← Tier 1 (CI)
│   ├── helpers/
│   │   ├── factories.ts           ← createTestUser, createTestManager, createTestConversation
│   │   ├── jwt.ts                 ← signTestToken({ role, supabaseId, userId })
│   │   ├── twilioMocks.ts         ← mockSmsProvider, signTwilioWebhook (computes HMAC)
│   │   └── db.ts                  ← truncateAll, beforeEach hook
│   ├── routes/                    ← Route-level tests (Fastify inject)
│   ├── services/                  ← Service-level tests (direct calls)
│   ├── jobs/                      ← Worker handler tests (direct calls)
│   └── setup.ts                   ← Global beforeAll/afterAll
├── e2e/                           ← Tier 2 (pre-prod)
│   ├── helpers/
│   │   ├── twilioReal.ts          ← sendRealSms (programmatically text from Twilio number 2)
│   │   ├── waitFor.ts             ← waitForConversationStatus, waitForCallback
│   │   └── ngrok.ts               ← optional: programmatic tunnel start/stop
│   ├── scenarios/
│   │   ├── 01-provision.test.ts
│   │   ├── 02-broadcast.test.ts
│   │   ├── 03-reply-flow.test.ts
│   │   └── ...
│   └── setup.ts                   ← Real env config, sanity checks
└── package.json
```

**npm scripts:**
```json
"test":        "vitest run --project ci",          // Tier 1, ~5 min
"test:watch":  "vitest --project ci",
"test:e2e":    "vitest run --project e2e",         // Tier 2, ~30 min, real services
"test:all":    "vitest run"                         // both — pre-release
```

Vitest workspaces let us configure CI vs e2e differently — different env vars,
different setup files, different timeouts.

---

## Infrastructure setup

### Tier 1 (CI) — ~4–6 hours one-time

- [ ] Create test database `reportloop_test` in your Postgres instance
- [ ] Set up `.env.test` with `TEST_DATABASE_URL`, `TEST_REDIS_URL`, real `SUPABASE_JWT_SECRET`
- [ ] Configure vitest workspace / project for `ci`
- [ ] Write helpers:
  - `signTestToken({ role, supabaseId, userId })` using `jsonwebtoken` + Supabase secret
  - `truncateAll()` — runs `TRUNCATE` on non-system tables in `beforeEach`
  - `signTwilioWebhook({ url, params, authToken })` — computes Twilio's HMAC-SHA1 signature
  - Factories: `createTestUser({ role })`, `createTestManager({ assignedPhone? })`, etc.
- [ ] Mock providers:
  - `mockSmsProvider` — `vi.fn()` for each method on `ISmsProvider`
  - `mockSupabaseAdmin` — same pattern
- [ ] App factory accepts deps for injection (might already)
- [ ] CI workflow file (GitHub Actions or whatever)

### Tier 2 (pre-prod) — ~4–6 hours one-time

- [ ] Provision two real Twilio numbers (or designate two existing):
  - Manager test number (e.g., `+19498674653`)
  - Participant test number (NEW, e.g., `+1...`) — used to programmatically send "participant" SMS
- [ ] Choose public URL strategy:
  - **ngrok** (simpler, free for our scale)
  - **Staging deploy** (more realistic, more setup)
- [ ] Configure Twilio number's webhook URL → public URL
- [ ] `.env.e2e` with real Twilio creds, real test DB, real Redis, real Supabase
- [ ] Helpers:
  - `sendRealSms({ from, to, body })` — uses Twilio API to send from the test participant number
  - `waitForConversationStatus(id, status, { timeoutMs })` — polls real DB
  - `waitForMessage(conversationId, body)` — polls messages table
- [ ] Pre-flight check at suite start: ngrok up? Test numbers reachable? DB clean?
- [ ] Cleanup routine: deletes test data after each scenario

---

## Categories overview

| # | Category | Count |
|---|---|---|
| 1 | User CRUD | 25 |
| 2 | Role transitions | 11 |
| 3 | Phone provisioning | 12 |
| 4 | Schedule lifecycle | 19 |
| 5 | Broadcast lifecycle | 14 |
| 6 | Inbound webhook — messages | 17 |
| 7 | Inbound webhook — STOP / START | 8 |
| 8 | Status callbacks | 6 |
| 9 | Route-level (HTTP gate) | 9 |
| 10 | Auth / RBAC | 13 |
| 11 | Cross-cutting / system | 12 |
| 12 | Group management | 12 |
| 13 | Question management | 7 |
| 14 | Conversation / message reads | 8 |
| 15 | Auth flows | 7 |
| 16 | Health / observability | 4 |
| | **Total** | **184** |

---

## 1. User CRUD

- [ ] **1.1** Create admin user  *(free)*
- [x] **1.2** Create manager user — triggers phone provisioning (`onManagerCreated`)  *(mock-pending)*
- [x] **1.3** Create viewer user  *(free)*
- [x] **1.4** Create participant user (no email, phone only)  *(free)*
- [x] **1.5** Create with missing required field → 400  *(free)*
- [x] **1.6** Create with duplicate email → 409  *(free)*
- [x] **1.7** Create with duplicate phone → 409  *(free)*
- [x] **1.8** Create with malformed email → 400  *(free)*
- [x] **1.9** Create with malformed phone (non-E.164) → 400  *(free)*
- [x] **1.10** Create user — non-admin caller → 403  *(free)*
- [ ] **1.11** List users (`GET /users`) — admin sees all  *(free)*
- [ ] **1.12** List users — manager sees only their group members  *needs verification*  *(free)*
- [ ] **1.13** List users — viewer sees only viewable managers' members  *needs verification*  *(free)*
- [ ] **1.14** Get user by id (`GET /users/:id`) — happy path  *(free)*
- [ ] **1.15** Get user — non-admin requesting another user → 403  *(free)*
- [ ] **1.16** Update user name/email/phone (no role change)  *(free)*
- [ ] **1.17** Update user — non-admin updating someone else → 403  *(free)*
- [ ] **1.18** Update user with duplicate email (different user) → 409  *(free)*
- [ ] **1.19** Update user with duplicate phone (different user) → 409  *(free)*
- [ ] **1.20** Update user — email change triggers Supabase metadata sync  *(free)*
- [ ] **1.21** Soft-delete user (DELETE /users/:id)  *(free)*
- [ ] **1.22** Soft-delete then list → not returned  *(free)*
- [x] **1.23** Soft-delete a manager → assignedPhone stays on the soft-deleted record  *(mock-pending)*
- [ ] **1.24** Cannot delete self  *needs verification*  *(free)*
- [ ] **1.25** Cannot demote sole remaining admin  *needs verification — open question whether enforced*  *(free)*

---

## 2. Role transitions

- [x] **2.1** viewer → manager → triggers provisioning, gets number  *(mock-pending)*
- [ ] **2.2** viewer → admin  *(free)*
- [ ] **2.3** manager → viewer → demotion cleanup (schedules + questions soft-deleted, ManagerGroup links removed, assignedPhone stays)  *(mock-pending)*
- [ ] **2.4** manager → admin → demotion cleanup runs  *(mock-pending)*
- [x] **2.5** Demote then re-promote → reclaims own assignedPhone (Step 1 of provisioning), no Twilio call  *(mock-pending)*
- [ ] **2.6** Promote viewer to manager when at PHONE_LIMIT_REACHED → manager created with no number, warning logged (does NOT throw)  *(mock-pending)*
- [ ] **2.7** Concurrent role-change attempts → last write wins  *(mock-pending)*
- [ ] **2.8** participant → manager — *open question: is this transition allowed?*  *(mock-pending)*
- [ ] **2.9** admin → viewer  *(free)*
- [ ] **2.10** admin → manager → triggers provisioning  *(mock-pending)*
- [ ] **2.11** Provisioning fires for both POST `/users` create-as-manager AND PATCH role-to-manager paths  *(mock-pending)*

---

## 3. Phone provisioning

- [ ] **3.1** First manager creation → Twilio API called, number bought  *(mock-pending)*
- [ ] **3.2** Second manager, no idle numbers → Twilio API called again  *(mock-pending)*
- [x] **3.3** New manager when an idle number exists → number recycled, no Twilio call  *(mock-pending)*
- [ ] **3.4** Manager re-promoted → reclaims their own number (Step 1, no Twilio)  *(mock-pending)*
- [x] **3.5** Hit PHONE_MAX_NUMBERS → 409 PHONE_LIMIT_REACHED  *(mock-pending)*
- [ ] **3.6** Twilio API fails (network / auth error) → 502 PROVISION_FAILED  *(mock-pending)*
- [ ] **3.7** Concurrent provisioning of same idle number → only one wins (transaction), second falls through  *(mock-pending)*
- [ ] **3.8** Manual `POST /users/:id/provision-number` — admin for any manager → success  *(mock-pending)*
- [ ] **3.9** Manual provision — manager for self → success  *(mock-pending)*
- [ ] **3.10** Manual provision — manager for another manager → 403  *(free)*
- [ ] **3.11** Manual provision — viewer for any → 403  *(free)*
- [ ] **3.12** Manual provision — target user is not a manager → 400  *(free)*

---

## 4. Schedule lifecycle

- [ ] **4.1** Create schedule for manager with phone → active OK  *(mock-pending)*
- [ ] **4.2** Create with `active: true` for manager without phone → forced `active: false` + `warning: 'PHONE_NUMBER_REQUIRED'`  *(mock-pending)*
- [ ] **4.3** Activate via PATCH for manager without phone → 422 PHONE_NUMBER_REQUIRED  *(mock-pending)*
- [ ] **4.4** Activate via PATCH for manager with phone → succeeds  *(mock-pending)*
- [ ] **4.5** Update non-active fields (label, time, etc.)  *(mock-pending)*
- [ ] **4.6** Soft-delete schedule  *(mock-pending)*
- [ ] **4.7** Soft-deleted schedule → broadcasts don't fire, doesn't appear in cron lookup  *(mock-pending)*
- [ ] **4.8** Schedule references soft-deleted question — *open question: filter excluded?*  *(mock-pending)*
- [ ] **4.9** `GET /schedules` — admin sees all  *(mock-pending)*
- [ ] **4.10** `GET /schedules` — manager sees only own  *(mock-pending)*
- [ ] **4.11** `GET /schedules` — viewer sees viewable managers' schedules  *(mock-pending)*
- [ ] **4.12** `GET /schedules/:id` — happy path  *(mock-pending)*
- [ ] **4.13** `GET /schedules/:id` — RBAC violations → 403  *(mock-pending)*
- [ ] **4.14** Create schedule with invalid timezone → 400  *(free)*
- [ ] **4.15** Create schedule with invalid dayOfWeek → 400  *(free)*
- [ ] **4.16** Create schedule with no scheduleRecipients (recipientMode: 'subset') — *open question: validation?*  *(free — assumes body-schema validation runs before manager lookup)*
- [ ] **4.17** Create schedule with no scheduleQuestions — *open question: validation?*  *(free — same caveat)*
- [ ] **4.18** Attach scheduleRecipient (subset mode) → only those participants targeted  *(mock-pending)*
- [ ] **4.19** Attach scheduleQuestion → broadcast sends those questions  *(mock-pending)*

---

## 5. Broadcast lifecycle

- [ ] **5.1** Manual trigger by admin → fires, conversations created  *(mock-pending)*
- [ ] **5.2** Manual trigger by manager (own schedule) → fires  *(mock-pending)*
- [ ] **5.3** Manual trigger by manager (other's schedule) → 403  *(mock-pending)*
- [ ] **5.4** Schedule cron fires at scheduled time → broadcast queued  *(mock-pending)*
- [ ] **5.5** Broadcast for manager with no `assignedPhone` → blocked at guard, error logged, no SMS sent  *(mock-pending)*
- [ ] **5.6** Broadcast skips opted-out participants  *(mock-pending)*
- [ ] **5.7** Broadcast skips participants with no phone  *(mock-pending)*
- [ ] **5.8** Two managers, same participant → both conversations created, no cross-routing on reply  *(mock-pending)*
- [ ] **5.9** Broadcast with `recipientMode: 'all'` → all group members targeted  *(mock-pending)*
- [ ] **5.10** Broadcast with `recipientMode: 'subset'` → only ScheduleRecipient rows targeted  *(mock-pending)*
- [ ] **5.11** Broadcast deduplication — same scheduleId + fireDate → uniqueness constraint  *(mock-pending)*
- [ ] **5.12** Broadcast retry on transient SMS failure (BullMQ retries)  *(mock-pending)*
- [ ] **5.13** `triggeredBy` field set correctly on manual trigger; null on cron-fired  *(mock-pending)*
- [ ] **5.14** `GET /broadcasts` list — *open question: in v1.2 or deferred?*  *(cost-tag pending — depends on endpoint existence; if read-only list it's `free`)*

---

## 6. Inbound webhook — message handling (Step 16)

- [ ] **6.1** Happy path — participant replies → message saved, conversation locked, conversationQueue enqueued  *(mock-pending)*
- [ ] **6.2** Empty body → log.debug + return  *(free)*
- [ ] **6.3** Whitespace-only body → log.debug + return  *(free)*
- [ ] **6.4** Duplicate Twilio SID (Layer 2 idempotency) → log.warn + return  *(mock-pending)*
- [ ] **6.5** Unknown participant → audit log UNKNOWN_PARTICIPANT, includes `toPhone`  *(free)*
- [ ] **6.6** Opted-out participant sends regular message → log.info + return, no DB write  *(free)*
- [ ] **6.7** Unknown manager number → log.info + return  *(free)*
- [ ] **6.8** Manager soft-deleted but number still active → log.info + return  *(mock-pending)*
- [ ] **6.9** No open conversation for participant + manager → log.warn + return  *(mock-pending)*
- [ ] **6.10** Out-of-turn (status: processing) → audit log `OUT_OF_TURN`  *(mock-pending)*
- [ ] **6.11** Out-of-turn (status: completed) → audit log `SESSION_COMPLETED`  *(mock-pending)*
- [ ] **6.12** Out-of-turn (status: timed_out) → audit log `SESSION_TIMED_OUT`  *(mock-pending)*
- [ ] **6.13** Out-of-turn (status: failed) → audit log `SESSION_FAILED`  *(mock-pending)*
- [ ] **6.14** Out-of-turn (status: superseded) → audit log `SESSION_SUPERSEDED`  *(mock-pending)*
- [ ] **6.15** Body too long (P2000) → log.warn + return, no retry  *(mock-pending)*
- [ ] **6.16** Manager A demoted, number reassigned to Manager B, participant replies → falls to "no open conversation"  *(mock-pending)*
- [ ] **6.17** Concurrent replies to same conversation → only one acquires lock, other audited as OUT_OF_TURN  *(mock-pending)*

---

## 7. Inbound webhook — STOP / START

- [ ] **7.1** Participant texts `STOP` → smsOptedOut=true, conversations failed (in `$transaction`)
- [ ] **7.2** Variant casing / whitespace (`stop `, ` Stop`) → still triggers
- [ ] **7.3** Each opt-out keyword (`STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`) → triggers
- [ ] **7.4** Each opt-in keyword (`START`, `YES`, `UNSTOP`) → opts back in
- [ ] **7.5** Unknown number texts STOP → log + return (no DB change)
- [ ] **7.6** Already-opted-out participant texts STOP → idempotent
- [ ] **7.7** Already-opted-in participant texts START → idempotent
- [ ] **7.8** Manager texts STOP from their own assigned number → opt-out applies (no role-based exclusion)

---

## 8. Inbound webhook — status callbacks

- [ ] **8.1** `failed` callback for known message → conversation marked `failed` with `failReason: 'TWILIO_DELIVERY_FAILED'`
- [ ] **8.2** `undelivered` callback for known message → same
- [ ] **8.3** `delivered` callback → no-op
- [ ] **8.4** `queued` / `sending` / `sent` / `read` callbacks → no-ops
- [ ] **8.5** Status callback for unknown message → silent return
- [ ] **8.6** Late `failed` callback after conversation already completed → `notIn: ['completed']` guard prevents overwrite

---

## 9. Inbound webhook — route-level (HTTP gate)

- [ ] **9.1** Valid Twilio signature → 200, job enqueued
- [ ] **9.2** Invalid signature → 403
- [ ] **9.3** Twilio SDK throws unexpectedly during validation → 403 (try/catch fallback)
- [ ] **9.4** Missing `From` field → 200 + warn log, not enqueued
- [ ] **9.5** Missing `To` field → 200 + warn log
- [ ] **9.6** Missing both `MessageSid` and `SmsSid` → 200 + warn log
- [ ] **9.7** MMS (`NumMedia > 0`) → 200 + log.info, not enqueued
- [ ] **9.8** Redis down at enqueue → 500 (Twilio retries the webhook)
- [ ] **9.9** Webhook exempt from `@fastify/rate-limit` (`config: { rateLimit: false }`)

---

## 10. Auth / RBAC

- [ ] **10.1** Missing Authorization header → 401
- [ ] **10.2** Bogus / malformed JWT → 401
- [ ] **10.3** Expired JWT → 401
- [ ] **10.4** Valid JWT, user soft-deleted → *open question: 401 or 403?*
- [ ] **10.5** Manager accesses admin-only endpoint → 403
- [ ] **10.6** Viewer accesses manager-scoped endpoint → 403
- [ ] **10.7** Field-level filtering — viewer/participant fetching a manager record sees `name` + `role` only, NOT `email` or `assignedPhone` *needs verification*
- [ ] **10.8** Token refresh — *if implemented*
- [ ] **10.9** `viewableManagerIds` correctly populated on `/auth/me` for viewers
- [ ] **10.10** Active manager selection (viewer can switch context)
- [ ] **10.11** Manager A queries manager B's conversations → 403
- [ ] **10.12** Manager A queries manager B's questions → 403
- [ ] **10.13** Manager A queries manager B's schedules → 403

---

## 11. Cross-cutting / system

- [ ] **11.1** Reminder cron sends reminder for stale conversation
- [ ] **11.2** Reminder cron times out conversation after max reminders
- [ ] **11.3** Reminder cron recovers stuck `processing` conversations (`runStuckRecovery`)
- [ ] **11.4** Cleanup worker purges soft-deleted records past retention window
- [ ] **11.5** Two managers, two participants, parallel broadcasts → 4 conversations, no cross-contamination
- [ ] **11.6** Participant in groups under multiple managers → both broadcasts reach them
- [ ] **11.7** Number recycled mid-active-conversation → Manager A's conversation soft-deleted on demotion
- [ ] **11.8** BullMQ jobId deduplication — duplicate Twilio retries within queue lifetime → only one job runs
- [ ] **11.9** Idempotency Layer 1 vs Layer 2 — Twilio retry within queue lifetime caught by Layer 1; outside lifetime caught by Layer 2
- [ ] **11.10** Schema migration — `toPhone` column nullable, existing rows valid as-is
- [ ] **11.11** Indexes used by hot queries (manager lookup, conversation lookup) — explain plan check
- [ ] **11.12** Soft-delete flag respected across all reads (no leakage of deleted users/groups/etc.)

---

## 12. Group management

- [ ] **12.1** Create group (admin only)
- [ ] **12.2** Update group name / description
- [ ] **12.3** Soft-delete group
- [ ] **12.4** List groups — admin sees all, manager sees assigned, viewer sees viewable managers' groups
- [ ] **12.5** Get group by id with member list
- [ ] **12.6** Add member to group (`POST /groups/:id/members`)
- [ ] **12.7** Remove member from group (`DELETE /groups/:id/members/:userId`)
- [ ] **12.8** Bulk replace members (`PUT /groups/:id/members` or similar)
- [ ] **12.9** Group with no members
- [ ] **12.10** Manager assigned to group via `ManagerGroup` (admin assigns)
- [ ] **12.11** Manager removed from group via `ManagerGroup` (admin removes, OR demotion cleanup)
- [ ] **12.12** Soft-deleted group doesn't appear in lookups, but its members and ManagerGroup links survive (or do they?) — *open question*

---

## 13. Question management

- [ ] **13.1** Create question — manager creating their own
- [ ] **13.2** Create question — admin can create on behalf of any manager *needs verification*
- [ ] **13.3** Update question text
- [ ] **13.4** Soft-delete question
- [ ] **13.5** Soft-deleted question's references in schedules — *open question: cascade or stale ref?*
- [ ] **13.6** Question text length / validation rules
- [ ] **13.7** List questions — manager sees own, admin sees all

---

## 14. Conversation / message reads

- [ ] **14.1** `GET /conversations` — list with RBAC scoping  *needs verification of endpoint*
- [ ] **14.2** `GET /conversations/:id` — single conversation detail  *needs verification*
- [ ] **14.3** `GET /conversations/:id/messages` — message thread  *needs verification*
- [ ] **14.4** `GET /conversations/:id/answers` — extracted answers  *needs verification*
- [ ] **14.5** Filter conversations by status
- [ ] **14.6** Filter conversations by manager
- [ ] **14.7** Filter conversations by date range
- [ ] **14.8** Viewer can only see their managers' conversations

---

## 15. Auth flows

- [ ] **15.1** `GET /auth/me` with valid token → user data + scope
- [ ] **15.2** `GET /auth/me` with no token → 401
- [ ] **15.3** `GET /auth/me` with expired token → 401
- [ ] **15.4** `GET /integrations/status` returns Twilio + AI provider state correctly
- [ ] **15.5** First-time login (Supabase invite acceptance) → user becomes active  *needs verification*
- [ ] **15.6** Password reset flow  *if implemented*
- [ ] **15.7** Logout (clears session)

---

## 16. Health / observability

- [ ] **16.1** `GET /health` → 200  *needs verification of endpoint*
- [ ] **16.2** Database disconnection → graceful error response (not server crash)
- [ ] **16.3** Redis disconnection → BullMQ producers fail-fast, route returns 500
- [ ] **16.4** Twilio disconnection during sendSms → typed errors propagate

---

## Status

| Category | Total | Passing | In progress | Not started |
|---|---|---|---|---|
| 1. User CRUD | 25 | 10 | 0 | 15 |
| 2. Role transitions | 11 | 2 | 0 | 9 |
| 3. Phone provisioning | 12 | 2 | 0 | 10 |
| 4. Schedule lifecycle | 19 | 0 | 0 | 19 |
| 5. Broadcast lifecycle | 14 | 0 | 0 | 14 |
| 6. Inbound webhook — messages | 17 | 0 | 0 | 17 |
| 7. Inbound webhook — STOP/START | 8 | 0 | 0 | 8 |
| 8. Status callbacks | 6 | 0 | 0 | 6 |
| 9. Route-level | 9 | 0 | 0 | 9 |
| 10. Auth / RBAC | 13 | 0 | 0 | 13 |
| 11. Cross-cutting | 12 | 0 | 0 | 12 |
| 12. Group management | 12 | 0 | 0 | 12 |
| 13. Question management | 7 | 0 | 0 | 7 |
| 14. Conversation reads | 8 | 0 | 0 | 8 |
| 15. Auth flows | 7 | 0 | 0 | 7 |
| 16. Health / observability | 4 | 0 | 0 | 4 |
| **Total** | **184** | **14** | **0** | **170** |

---

## Open questions

### Already decided in brainstorming

- ✅ **Scope** — full backend, not v1.2-only
- ✅ **Frontend independence** — backend HTTP/service-level only; no browser, no frontend dependencies
- ✅ **Tier strategy** — two tiers: CI (mocked Twilio, every commit) + E2E (real Twilio, pre-prod)
- ✅ **Test DB** — dedicated `reportloop_test` database, real Postgres, truncate per test
- ✅ **Redis** — real Redis with test-namespaced queue names
- ✅ **Twilio mocking (CI)** — at `ISmsProvider` interface boundary
- ✅ **Supabase auth (CI)** — locally signed JWTs using real `SUPABASE_JWT_SECRET`
- ✅ **BullMQ (CI)** — handlers tested directly; a few targeted tests for retry/dispatch behavior

### Coverage / scope (still open — code-checks)

1. Is `participant → manager` role transition supported? (2.8)
2. Is "cannot delete self" enforced? (1.24)
3. Is "cannot demote sole admin" enforced? (1.25)
4. What does the schedule do when its referenced question is soft-deleted? (4.8, 13.5)
5. Are scheduleRecipients/scheduleQuestions empty-list cases validated? (4.16, 4.17)
6. Is `GET /broadcasts` available in v1.2 or deferred to v2? (5.14)
7. Are conversation/message read endpoints (`GET /conversations/...`) implemented? (14.1–14.4)
8. Is field-level filtering by RBAC role enforced? (10.7)
9. Does soft-deleting a group cascade to its links? (12.12)
10. Is `GET /health` exposed? (16.1)

### Tier 2 infrastructure (still open — strategic)

11. **Public URL** — ngrok (simpler, free) or staging deploy (more realistic, more setup)?
12. **Two real Twilio test numbers** — provision now, or use existing dev numbers? (Need 2: 1 for manager, 1 for programmatic participant)
13. **Twilio account** — same as prod, or a separate Twilio sub-account for tests?
14. **CI platform** — GitHub Actions? GitLab? Something else? (Affects how Tier 1 runs in CI)
15. **Tier 1 Postgres in CI** — service container (e.g., GitHub Actions `services:`) or hosted (e.g., Supabase test project)?

### Per-scenario decisions (still open)

16. **Marking each scenario with `CI` / `E2E` / `both`** — most are CI-only. The Tier 2 list above (~15) gets `E2E` or `both`. Walk the 184 list once and tag.
17. **Priorities** — within Tier 1, flag the top-20 must-pass-before-merge scenarios.

---

## Next steps

1. **Resolve open questions 1–10** (mostly code-checks — grep the routes, ~30 min)
2. **Resolve open questions 11–15** (Tier 2 infrastructure decisions, ~10 min of decisions)
3. **Walk the 184 list** and tag each scenario `CI` / `E2E` / `both`
4. **Mark Tier 1 top-20 priorities** (the green-before-merge set)
5. **Set up Tier 1 infrastructure** (~4–6 hours one-time)
6. **Write a smoke test against the harness** — first 5 scenarios from category 3 (provisioning, simplest) to validate setup
7. **Write Tier 1 tests, category by category** (~3-5 sessions of focused work)
8. **Once Tier 1 has a healthy bulk passing, set up Tier 2 infrastructure** (~4–6 hours)
9. **Write the ~15 Tier 2 scenarios** (one focused session)
10. **Run Tier 2 once before each release going forward**

Estimated total time to "v1.2 has both tiers working": ~25–35 hours of focused work, doable across 4–5 sessions.
