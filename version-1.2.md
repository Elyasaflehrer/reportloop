# Version 1.2 — Per-Manager Phone Numbers

## Background

Each manager gets their own dedicated phone number. Inbound replies route using `To` (manager's
number) + `From` (participant's phone) together. No global fallback number exists.

Full strategy: `manager-phone-strategy.md`
Full architecture: `backend/docs/per-manager-phone-numbers.md`

---

## New files

| File | Purpose |
|---|---|
| `backend/src/utils/retry.ts` | Generic `withRetry` utility |
| `backend/src/services/sms/phone-number.errors.ts` | `ProvisionLimitError`, `ProvisionFailedError` |
| `backend/src/services/sms/phone-number.service.ts` | 3-step `provisionForManager` logic |
| `backend/src/services/manager.service.ts` | Manager lifecycle — `onManagerCreated` |
| `backend/src/jobs/inbound.worker.ts` | Inbound webhook handlers — opt-out / opt-in / status callback / regular message |

---

## Modified files

| File | What changes |
|---|---|
| `backend/prisma/schema.prisma` | Add `assignedPhone` + `assignedPhoneSid` to User; add `toPhone` to `InboundAuditLog` |
| `backend/src/config.ts` | Remove `fromNumber`, add phone/webhook config |
| `backend/src/middleware/rbac.ts` | Add `assignedPhone` to `AuthUser` + DB select |
| `backend/src/services/sms/sms.provider.interface.ts` | `from` required, `provisionNumber`, `to` in payload |
| `backend/src/services/sms/providers/twilio.provider.ts` | Implement `provisionNumber`, update send/receive |
| `backend/src/app.ts` | Create `smsProvider` once, pass to both routes |
| `backend/src/routes/users.ts` | Accept `smsProvider`, provision on create, new endpoint |
| `backend/src/routes/auth.ts` | Remove `fromNumber` from `/integrations/status` |
| `backend/src/routes/schedules.ts` | Enforce inactive when manager has no `assignedPhone` |
| `backend/src/routes/webhooks.ts` | Rewrite as thin gate — validate signature, extract fields, enqueue to `inboundQueue`, return 200 |
| `backend/src/jobs/queue.ts` | Add `inboundQueue` alongside `conversationQueue` |
| `backend/src/index.ts` | Register `startInboundWorker()` (guarded by Twilio configured) |
| `backend/src/services/broadcast.service.ts` | Guard + required `from` |
| `backend/src/jobs/conversation.worker.ts` | Required `from` |
| `backend/src/jobs/reminder.worker.ts` | Required `from` |
| `frontend/src/types/index.ts` | Add `assignedPhone` to `User` |
| `frontend/src/contexts/SessionContext.tsx` | `assignedPhone` in session, update after provision |
| `frontend/src/components/admin/AdminUsersTab.tsx` | Phone column + assign button |
| `frontend/src/components/manager/ManagerWorkspace.tsx` | Phone display + request button + guard |

---

## Implementation Order

Each step depends on the previous — do not reorder. Test after each section before continuing.

**Section A — Foundation** *(test after Step 6)*
1. Schema
2. Config
3. SMS provider interface
4. Twilio provider
5. `retry.ts` utility
6. `phone-number.errors.ts`

**Section B — Provisioning Logic** *(test after Step 8)*
7. `phone-number.service.ts`
8. `manager.service.ts`

**Section C — Backend API** *(test after Step 12)*
9. `rbac.ts` middleware
10. `app.ts`
11. `users.ts` route
11a. `schedules.ts` route — activation guard
11b. `users.ts` — manager demotion cleanup (schedules + questions soft-deleted)
12. `auth.ts` — remove `fromNumber`

**Section D — Workers + Broadcast** *(test after Step 15)*
13. Broadcast service
14. Conversation worker
15. Reminder worker

**Section E — Webhooks** *(test after Step 16)*
16. Webhook routing

**Section F — Frontend** *(test after Step 19)*
17. Frontend types + session context
18. Admin dashboard UI
19. Manager dashboard UI

---

## Step 1 — Schema

**File:** `backend/prisma/schema.prisma`

Add to the `User` model after `smsOptedOut`:
```prisma
assignedPhone    String?  @unique @map("assigned_phone")
assignedPhoneSid String?  @unique @map("assigned_phone_sid")
```

Apply via Supabase SQL editor:
```sql
ALTER TABLE users ADD COLUMN assigned_phone TEXT UNIQUE;
ALTER TABLE users ADD COLUMN assigned_phone_sid TEXT UNIQUE;

-- Deactivate all schedules belonging to managers who have no phone number.
-- Existing managers without a number cannot send broadcasts — their schedules
-- should be inactive so the cron never fires a broadcast that will fail.
UPDATE schedules SET active = false
WHERE manager_id IN (
  SELECT id FROM users WHERE role = 'manager' AND assigned_phone IS NULL
);
```

- [x] SQL applied in Supabase
- [x] `schema.prisma` updated

---

## Step 2 — Config

**File:** `backend/src/config.ts`

Remove `fromNumber` / `TWILIO_FROM_NUMBER` entirely from the twilio config block.

Add a new `phone` config block:
```ts
phone: z.object({
  maxNumbers:    z.coerce.number().default(50),    // PHONE_MAX_NUMBERS
  numberCountry: z.string().default('US'),          // PHONE_NUMBER_COUNTRY
  numberType:    z.string().default('local'),       // PHONE_NUMBER_TYPE
})

webhookRetryAttempts: z.coerce.number().default(2), // WEBHOOK_RETRY_ATTEMPTS
```

Update `twilioConfigured` guard — only `ACCOUNT_SID` + `AUTH_TOKEN` required.

Also note: `API_BASE_URL` must already exist in config (used to build the webhook URL
`${config.apiBaseUrl}/webhooks/twilio` when provisioning a number).

- [x] Config updated

---

## Step 3 — SMS provider interface

**File:** `backend/src/services/sms/sms.provider.interface.ts`

Three changes:

**`sendSms` — `from` becomes required:**
```ts
sendSms(to: string, body: string, from: string): Promise<string>
```
No global fallback exists. By the time `sendSms` is called the broadcast guard has
already verified `manager.assignedPhone` is set. Making `from` required catches any
caller that forgets to pass it at compile time, not at runtime in production.

**New method `provisionNumber`:**
```ts
provisionNumber(params: {
  webhookUrl:  string
  country:     string
  numberType:  string
}): Promise<{ assignedPhone: string; assignedPhoneSid: string }>
```
Each provider implements its own provisioning. Throws on failure.

**`InboundSmsPayload` — add `to`:**
```ts
export type InboundSmsPayload = {
  from:      string  // participant's phone (From)
  to:        string  // manager's number (To) — NEW
  body:      string
  messageId: string
}
```

- [x] Interface updated

---

## Step 4 — Twilio provider

**File:** `backend/src/services/sms/providers/twilio.provider.ts`

**`provisionNumber({ webhookUrl, country, numberType })`:**
- `this.client.availablePhoneNumbers(country)[numberType].list({ limit: 1 })` — find available
- `this.client.incomingPhoneNumbers.create({ assignedPhone, smsUrl: webhookUrl, smsMethod: 'POST' })` — purchase + configure
- Return `{ assignedPhone: purchased.assignedPhone, assignedPhoneSid: purchased.sid }`
- Throw on any failure

**`sendSms(to, body, from)`:**
- `from` is now a required string, pass directly
- Remove `?? this.cfg.fromNumber` — no fallback logic

**`parseInboundWebhook`:**
- Extract `req.body.To` and return as `to` in the payload

- [x] Twilio provider updated

---

## Step 5 — `retry.ts` utility

**File:** `backend/src/utils/retry.ts` *(new)*

```ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number }
): Promise<T>
```

- Tries `fn()` up to `opts.attempts` times
- On failure: waits `delayMs * attempt` (300ms, 600ms for default 2 attempts)
- If all attempts fail: re-throws the last error
- Total max delay stays well under Twilio's 15s webhook timeout

Used only in webhook routing. Generic enough to use elsewhere.

- [x] `retry.ts` created

---

## Step 6 — `phone-number.errors.ts`

**File:** `backend/src/services/sms/phone-number.errors.ts` *(new)*

```ts
export class ProvisionLimitError extends Error {
  readonly code = 'PHONE_LIMIT_REACHED'
}

export class ProvisionFailedError extends Error {
  readonly code = 'PROVISION_FAILED'
}
```

The `code` property lets the route handler return a typed error to the frontend
without an `instanceof` chain:
```ts
return res.status(err.statusCode).json({ error: err.code })
```

Frontend maps `PHONE_LIMIT_REACHED` → "No numbers available. Contact your admin."
Frontend maps `PROVISION_FAILED` → "Could not assign a number. Try again."

- [x] Error file created

---

## Test — Section A (Foundation)

Write a one-off script `backend/src/scripts/test-provision.ts`:

```ts
import { createSmsProvider } from '../services/sms/providers/twilio.provider.js'
import { config } from '../config.js'

const provider = createSmsProvider(config.twilio!)
const result = await provider.provisionNumber({
  webhookUrl: `${config.apiBaseUrl}/webhooks/twilio`,
  country:    config.phone.numberCountry,
  numberType: config.phone.numberType,
})
console.log(result)
// Expected: { assignedPhone: '+1...', assignedPhoneSid: 'PN...' }
```

Run it: `npx tsx src/scripts/test-provision.ts`

- [x] Console prints a `assignedPhone` (E.164) and `assignedPhoneSid`
- [x] Number appears in Twilio console with the webhook URL set
- [x] Server starts without errors (`config.ts` compiles, `fromNumber` removed)

> Release the test-purchased number manually from Twilio console after verifying.

---

## Step 7 — `phone-number.service.ts`

**File:** `backend/src/services/sms/phone-number.service.ts` *(new)*

Single exported function — follows the same parameter injection pattern as `broadcast.service.ts`:

```ts
export async function provisionForManager(
  userId: number,
  deps: {
    prisma:      PrismaClient
    smsProvider: ISmsProvider
    config:      AppConfig
  }
): Promise<string>   // returns the assigned assignedPhone
```

**Step 1 — own number:**
Query the user. If `assignedPhone` is already set, return it immediately — no Twilio call.
Handles role-churn: same user re-promoted always gets their own number back.

**Step 2 — idle number (wrapped in `$transaction`):**
Two concurrent manager creations could both find the same idle number. Wrapping in a
transaction means only one wins — the second gets a unique constraint error from Postgres
and must fall through to Step 3.

Inside the transaction:
- `findFirst` a user where `assignedPhone != null`, `role != 'manager'`, `id != userId`
- If found: move `assignedPhone` + `assignedPhoneSid` to the target user, clear from the source
- Return the number

**Step 3 — purchase limit:**
Count all users (active + soft-deleted) with a non-null `assignedPhone`.
If count ≥ `config.phone.maxNumbers` → throw `ProvisionLimitError`.

**Step 4 — provision from SMS provider:**
```ts
const webhookUrl = `${config.apiBaseUrl}/webhooks/twilio`
const result = await smsProvider.provisionNumber({
  webhookUrl,
  country:    config.phone.numberCountry,
  numberType: config.phone.numberType,
})
await prisma.user.update({
  where: { id: userId },
  data: { assignedPhone: result.assignedPhone, assignedPhoneSid: result.assignedPhoneSid },
})
return result.assignedPhone
```
On any error → throw `ProvisionFailedError`.

- [x] Service created

---

## Step 8 — `manager.service.ts`

**File:** `backend/src/services/manager.service.ts` *(new)*

Orchestrates all actions that happen when a manager is created or promoted.
Thin wrapper that keeps the route handler clean and makes the logic testable and extensible.

```ts
export async function onManagerCreated(
  userId: number,
  deps: {
    prisma:      PrismaClient
    smsProvider: ISmsProvider | null
    config:      AppConfig
  }
): Promise<void>
```

- If `deps.smsProvider` is null (Twilio not configured) → log and return, no provisioning
- Call `provisionForManager(userId, deps)`
- On `ProvisionLimitError` or `ProvisionFailedError` → log warning, do NOT throw
  (manager is created without a number, blocked from broadcasting until resolved)
- On unexpected error → log error, do NOT throw

`onManagerCreated` is called from both:
- `POST /users` when `role === 'manager'`
- `PATCH /users/:id` when role changes to `'manager'` (promotion)

- [x] Service created

---

## Test — Section B (Provisioning Logic)

Extend `test-provision.ts` or write three focused scripts, one per path:

**Path 1 — user already has a number (no Twilio call):**
- Set `assignedPhone` directly on a test user in DB
- Call `provisionForManager(userId, deps)` → must return the existing number without calling Twilio
- Verify Twilio console shows no new purchase

**Path 2 — idle number recycled (no Twilio call):**
- Create a non-manager user with a `assignedPhone` set in DB
- Call `provisionForManager(newManagerId, deps)`
- Verify: new manager has the number, source user's `assignedPhone` is null, no Twilio purchase

**Path 3 — new number purchased:**
- Ensure no idle numbers exist
- Call `provisionForManager(managerId, deps)` → purchases from Twilio
- Verify: DB updated with number + SID, number appears in Twilio console

**Limit guard:**
- Set `PHONE_MAX_NUMBERS=0` (or count current numbers as ≥ limit)
- Call `provisionForManager` → must throw `ProvisionLimitError` with `code: 'PHONE_LIMIT_REACHED'`

- [ ] All three provisioning paths verified
- [ ] `ProvisionLimitError` thrown correctly when at limit
- [ ] `onManagerCreated` logs and does NOT throw on provision failure

---

## Step 9 — `rbac.ts` middleware

**File:** `backend/src/middleware/rbac.ts`

Two changes:

**Add `assignedPhone` to `AuthUser` type:**
```ts
type AuthUser = {
  id:          number
  supabaseId:  string
  name:        string
  email:       string | null
  role:        UserRole
  assignedPhone: string | null   // ← NEW
}
```

**Add `assignedPhone` to the DB select in `authenticate`:**
```ts
select: { id: true, supabaseId: true, name: true, email: true, role: true, assignedPhone: true }
```

`GET /auth/me` returns `{ user: req.user, scope }` — `req.user` is built here.
No change needed in `auth.ts` — `assignedPhone` flows through automatically.

- [ ] `rbac.ts` updated

---

## Step 10 — `app.ts`

**File:** `backend/src/app.ts`

Currently `smsProvider` is created inside `if (config.twilio)` and only passed to
`webhooksRoutes`. We need to share it with `usersRoutes` too.

Refactor to create it once outside the condition:
```ts
const smsProvider: ISmsProvider | null = config.twilio ? createSmsProvider() : null

await app.register(usersRoutes, { smsProvider })   // null if Twilio not configured

if (smsProvider) {
  await app.register(webhooksRoutes, { smsProvider })
}
```

`usersRoutes` receives `smsProvider | null` — provisioning is skipped when null.
`webhooksRoutes` only registers when Twilio is configured (unchanged behavior).

- [ ] `app.ts` updated

---

## Step 11 — `users.ts` route

**File:** `backend/src/routes/users.ts`

**Update signature to accept options:**
```ts
export async function usersRoutes(
  app: FastifyInstance,
  opts: { smsProvider: ISmsProvider | null }
)
```

**`POST /users` — provision on create:**
After the user is saved, if `role === 'manager'`:
```ts
await onManagerCreated(user.id, { prisma, smsProvider: opts.smsProvider, config })
```
`onManagerCreated` handles all errors internally — `POST /users` always returns the user.

**`PATCH /users/:id` — handle role change to manager:**
If `body.role === 'manager'` and current user role is not already `manager`:
```ts
await onManagerCreated(user.id, { prisma, smsProvider: opts.smsProvider, config })
```

**New endpoint `POST /users/:id/provision-number`:**

Permission check:
- `admin` → allowed for any user with `role === 'manager'`
- `manager` → allowed only for themselves
- Anyone else → 403

Validation:
- Target user must have `role === 'manager'` → 400 if not

Logic:
```ts
try {
  const assignedPhone = await provisionForManager(targetUserId, {
    prisma, smsProvider: opts.smsProvider!, config
  })
  return reply.send({ assignedPhone })
} catch (err) {
  if (err instanceof ProvisionLimitError)
    return reply.status(429).send({ error: err.code })
  if (err instanceof ProvisionFailedError)
    return reply.status(502).send({ error: err.code })
  throw err
}
```

**Add `assignedPhone` to all user `select` blocks** — GET /users, GET /users/:id, PATCH /users/:id.

- [ ] Route updated

---

## Step 11a — `schedules.ts` route — activation guard

**File:** `backend/src/routes/schedules.ts`

Managers without a `assignedPhone` cannot have active schedules — there is nothing to send from.
Enforce this at the route layer so schedules accurately reflect reality in the UI.

**`POST /schedules` — force inactive if no phone number:**

The manager can create a schedule even without a phone number (useful for setting up in advance).
But `active` is silently forced to `false` and a warning is included in the response:

```ts
const manager = await prisma.user.findUnique({
  where: { id: req.user.id },
  select: { assignedPhone: true },
})

const forcedInactive = body.active && !manager?.assignedPhone
const schedule = await prisma.schedule.create({
  data: { ...body, active: forcedInactive ? false : body.active },
})

return reply.send({
  schedule,
  ...(forcedInactive && { warning: 'PHONE_NUMBER_REQUIRED' }),
})
```

**`PATCH /schedules/:id` — reject activation if no phone number:**

If the manager tries to explicitly set `active: true` but has no `assignedPhone` → `422`:

```ts
if (body.active === true) {
  const manager = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { assignedPhone: true },
  })
  if (!manager?.assignedPhone) {
    return reply.status(422).send({ error: 'PHONE_NUMBER_REQUIRED' })
  }
}
```

**Frontend response to `PHONE_NUMBER_REQUIRED`:**
- On create warning: show inline notice on the new schedule row — *"Inactive until a phone number is assigned."*
- On patch 422: show error — *"You need a phone number before activating a schedule. Request one from the dashboard."*

When a manager later gets a phone number (via "Request phone number" button), they activate
their schedules manually — no auto-activation. This avoids surprising re-activations for
schedules the manager may have intentionally left off.

- [ ] `schedules.ts` updated

---

## Step 11b — Manager demotion cleanup

**Files:** `backend/src/services/manager.service.ts`, `backend/src/routes/users.ts`

---

### Code structure

Business logic lives in the service, not the route. `manager.service.ts` becomes the home
for the full manager lifecycle — both creation and demotion mirror each other:

```
onManagerCreated(userId, deps)         → provisions phone, swallows errors (non-critical)
onManagerDemoted(userId, data, deps)   → runs cleanup, lets errors bubble (demotion is a hard stop)
```

The route handler is a thin orchestrator — it reads like a policy, not an implementation:

```ts
const newRole              = body.data.role ?? existing.role
const wasDemotedFromManager = existing.role === 'manager' && newRole !== 'manager'
const wasPromotedToManager  = existing.role !== 'manager' && newRole === 'manager'

const user = wasDemotedFromManager
  ? await onManagerDemoted(userId, body.data, { prisma, select: userSelect })
  : await prisma.user.update({ where: { id: userId }, data: body.data, select: userSelect })

// Supabase metadata sync (same for both paths)
if (user.supabaseId && (body.data.role || body.data.name)) { ... }

// Promotion side-effect
if (wasPromotedToManager && opts.smsProvider) {
  void onManagerCreated(userId, { prisma, smsProvider: opts.smsProvider, phoneSettings })
}
```

---

### `userSelect` — defined once in `users.ts`, passed into the service

The route owns the HTTP response shape. `userSelect` is a named const used in both the
plain `user.update` path and passed into `onManagerDemoted` via deps — no duplication,
no circular dependency:

```ts
const userSelect = {
  id: true, supabaseId: true, name: true, email: true, phone: true,
  initials: true, title: true, role: true, active: true,
  assignedPhone: true, updatedAt: true,
} as const satisfies Prisma.UserSelect
```

---

### `onManagerDemoted` — in `manager.service.ts`

Signature mirrors `onManagerCreated` in style:

```ts
export async function onManagerDemoted<S extends Prisma.UserSelect>(
  userId:     number,
  updateData: Prisma.UserUpdateInput,
  deps: { prisma: PrismaClient; select: S }
): Promise<Prisma.UserGetPayload<{ select: S }>>
```

**Layer 1 — `$transaction` (role change + schedule soft-delete):**

Both commit together or both roll back. If this fails, the error bubbles up to the route
→ global error handler → admin gets a 500 and retries. Never leaves an active schedule
on a non-manager.

```ts
const user = await deps.prisma.$transaction(async (tx) => {
  const updated = await tx.user.update({
    where:  { id: userId },
    data:   updateData,
    select: deps.select,
  })
  await tx.schedule.updateMany({
    where: { managerId: userId, deletedAt: null },
    data:  { active: false, deletedAt: new Date() },  // one SQL UPDATE, two fields
  })
  return updated
})
```

**Layer 2 — fire-and-forget (questions + group links):**

Orphaned questions and group links carry no broadcast risk. Failures are logged but
do not fail the HTTP response — the critical cleanup already committed:

```ts
deps.prisma.$transaction([
  deps.prisma.question.updateMany({
    where: { managerId: userId, deletedAt: null },
    data:  { deletedAt: new Date() },
  }),
  deps.prisma.managerGroup.deleteMany({
    where: { managerId: userId },
  }),
]).catch(err => console.error('[manager] demotion layer-2 cleanup failed', { userId, err }))

return user as Prisma.UserGetPayload<{ select: S }>
```

---

### Why errors bubble from `onManagerDemoted` but not `onManagerCreated`

| Function | On error |
|---|---|
| `onManagerCreated` | Swallows — manager is created without a phone, self-heals later |
| `onManagerDemoted` | Bubbles — a partial demotion (role changed, schedules still active) would send live broadcasts |

---

### What stays intact

- `assignedPhone` — never cleared; provisioning Step 1 reclaims it on re-promotion
- Broadcast + conversation history — permanent audit record, never touched
- Groups themselves — only the `ManagerGroup` link is removed; groups survive for reassignment
- `GroupMember` rows — participants inside those groups are untouched

- [x] `onManagerDemoted` added to `manager.service.ts`
- [x] `userSelect` const added to `users.ts`
- [x] PATCH handler refactored to use both service functions

---

## Step 12 — `auth.ts` — remove `fromNumber`

**File:** `backend/src/routes/auth.ts`

The `/integrations/status` endpoint still references `config.twilio.fromNumber`:
```ts
fromNumber: maskPhone(config.twilio.fromNumber)  // ← remove this line
```

`TWILIO_FROM_NUMBER` is gone from config — remove the reference.

- [x] `auth.ts` updated

---

## Test — Section C (Backend API)

Use curl or Postman against the running dev server:

**Create manager → auto-provision:**
```bash
POST /users  { "name": "Test Manager", "email": "...", "role": "manager" }
```
- [ ] Response includes `assignedPhone` (non-null)
- [ ] `assigned_phone` set in DB for that user

**Manual provision endpoint:**
```bash
POST /users/:id/provision-number  (for a manager with no number)
```
- [ ] Returns `{ assignedPhone: '+1...' }`
- [ ] 429 + `PHONE_LIMIT_REACHED` when at limit
- [ ] 403 for non-admin/non-self callers

**`GET /auth/me`:**
- [ ] Response includes `assignedPhone` field on the user object

**Schedule guard — POST:**
```bash
POST /schedules  { ..., "active": true }  (as manager with no assignedPhone)
```
- [ ] Schedule saved with `active: false`
- [ ] Response includes `warning: 'PHONE_NUMBER_REQUIRED'`

**Schedule guard — PATCH:**
```bash
PATCH /schedules/:id  { "active": true }  (as manager with no assignedPhone)
```
- [ ] Returns 422 `{ "error": "PHONE_NUMBER_REQUIRED" }`

**`/integrations/status`:**
- [ ] Response no longer includes `fromNumber`

---

## Step 13 — Broadcast service

**File:** `backend/src/services/broadcast.service.ts`

**Extend schedule select to include `assignedPhone`:**
```ts
manager: { select: { id: true, assignedPhone: true } }
```

**Broadcast guard — reject before sending:**
```ts
if (!schedule.manager.assignedPhone) {
  throw new Error(`Manager ${schedule.manager.id} has no phone number — broadcast blocked`)
}
```

**Pass as required `from`:**
```ts
await smsProvider.sendSms(participant.phone, body, schedule.manager.assignedPhone)
```

- [x] Broadcast service updated

---

## Step 14 — Conversation worker

**File:** `backend/src/jobs/conversation.worker.ts`

Extend include:
```ts
schedule: { include: { manager: { select: { assignedPhone: true } } } }
```

Pass as required `from`:
```ts
await smsProvider.sendSms(phone, body, conversation.broadcast.schedule.manager.assignedPhone!)
```

Guard: if `assignedPhone` is null, log error and skip the message — do not crash the worker.

- [x] Worker updated

---

## Step 15 — Reminder worker

**File:** `backend/src/jobs/reminder.worker.ts`

Same pattern as Step 14 — extend select, guard for null, pass `assignedPhone` as required `from`.

- [x] Worker updated

---

## Test — Section D (Workers + Broadcast)

**Broadcast guard:**
- Trigger a broadcast for a manager who has no `assignedPhone`
- [ ] Broadcast is blocked before any SMS is sent
- [ ] Error logged: `"Manager X has no phone number — broadcast blocked"`
- [ ] No Twilio API call made

**Broadcast with phone number:**
- Trigger a broadcast for a manager who has a `assignedPhone`
- [ ] SMS arrives at participant's phone
- [ ] SMS `From` header matches the manager's provisioned number (check Twilio logs)

**Workers:**
- Trigger a conversation worker job and a reminder worker job for a manager with a number
- [ ] Both pass `from` correctly — SMS arrives `From` the manager's number
- [ ] If `assignedPhone` is null (simulate by nulling in DB): worker logs error and skips, does not crash

---

## Step 16 — Webhook routing

Rewrite Twilio webhook from synchronous handler to two-queue async pipeline:
route returns 200 immediately, BullMQ worker handles all business logic with
retries.

**Architecture, edge cases, file specs, and end-to-end test plan:**
→ `backend/docs/inbound-webhook-routing.md`

**Implementation decisions (10 design decisions, locked):**
→ `step-16-implementation-plan.md`

### Implementation order — two sub-steps

**16a — Schema migration** *(one prisma change + one SQL statement)*

| Action | Where |
|---|---|
| Add `toPhone String? @map("to_phone")` to `InboundAuditLog` | `prisma/schema.prisma` |
| `ALTER TABLE inbound_audit_logs ADD COLUMN to_phone TEXT` | Supabase SQL editor |

Done first — column must exist in prod before any 16b code references it.

**16b — Inbound pipeline** *(four files, one commit, one end-to-end test)*

| File | Role |
|---|---|
| `jobs/queue.ts` | Add `inboundQueue` alongside `conversationQueue` |
| `routes/webhooks.ts` | Thin gate — validate, extract, enqueue, return 200 |
| `jobs/inbound.worker.ts` *(new)* | All handlers + dispatch |
| `index.ts` | Register `startInboundWorker()` |

These four files form one inbound pipeline and cannot ship independently.
End-to-end test (real SMS → DB row) is the only meaningful gate.

- [ ] 16a — schema applied (`prisma` + Supabase SQL)
- [ ] 16b — inbound pipeline wired (4 files + end-to-end test pass)

---

## Step 17 — Frontend types + session context

**File:** `frontend/src/types/index.ts`
```ts
export interface User {
  // ...existing fields
  assignedPhone: string | null
}
```

**File:** `frontend/src/contexts/SessionContext.tsx` *(or equivalent)*

`assignedPhone` flows automatically through `GET /auth/me` → `req.user` (Step 9).

After a successful `POST /users/:id/provision-number`, update the session in place so
the UI reacts immediately without a page reload:
```ts
const handleProvision = async (userId: number) => {
  const res = await api.post(`/users/${userId}/provision-number`)
  setSession(prev => ({
    ...prev,
    user: { ...prev.user, assignedPhone: res.assignedPhone }
  }))
}
```

- [ ] Types updated
- [ ] Session context updated

---

## Step 18 — Admin dashboard

**File:** `frontend/src/components/admin/AdminUsersTab.tsx`

- Add "Phone #" column — visible only for rows where `user.role === 'manager'`
- `user.assignedPhone` set → display the number
- `user.assignedPhone` null → render "Assign number" button
- Button calls `POST /users/:id/provision-number`
  - On success → replace button with returned `assignedPhone`
  - On `PHONE_LIMIT_REACHED` → show: *"No numbers available. Raise PHONE_MAX_NUMBERS."*
  - On `PROVISION_FAILED` → show: *"Failed to assign. Try again."*

- [ ] Admin UI updated

---

## Step 19 — Manager dashboard

**File:** `frontend/src/components/manager/ManagerWorkspace.tsx`

Read `assignedPhone` from session context.

**Has `assignedPhone`:**
- Show in workspace header: *"Your number: +1 (202) 555-1234"*
- Broadcast/Schedule tabs: buttons enabled normally

**No `assignedPhone`:**
- Show in workspace header: *"No phone number assigned."* + "Request phone number" button
- Button calls `POST /users/me/provision-number`
  - On success → updates session context (Step 17) → header updates, buttons enable
  - On `PHONE_LIMIT_REACHED` → show error: *"No numbers available. Contact your admin."*
  - On `PROVISION_FAILED` → show error: *"Could not assign a number. Try again."*
- Broadcast/Schedule tabs: "Send now" and "Schedule" buttons disabled with tooltip

- [ ] Manager workspace updated

---

## Test — Section F (Frontend)

**Admin dashboard:**
- Open `/admin` → Users tab
- [ ] "Phone #" column visible for manager rows only
- [ ] Manager with a number: column shows the number
- [ ] Manager without a number: "Assign number" button shown
- Click "Assign number" → loading state → number appears in column, button gone
- [ ] On `PHONE_LIMIT_REACHED`: shows *"No numbers available. Raise PHONE_MAX_NUMBERS."*
- [ ] On `PROVISION_FAILED`: shows *"Failed to assign. Try again."*

**Manager workspace (logged in as manager with a number):**
- [ ] Workspace header shows *"Your number: +1 (XXX) XXX-XXXX"*
- [ ] "Send now" and "Schedule" buttons are enabled

**Manager workspace (logged in as manager without a number):**
- [ ] Workspace header shows *"No phone number assigned."* + "Request phone number" button
- [ ] "Send now" and "Schedule" buttons are disabled
- Click "Request phone number" → loading → header updates to show number, buttons enable
- [ ] No page reload — session updates in place
- [ ] On `PHONE_LIMIT_REACHED`: shows *"No numbers available. Contact your admin."*

---

## Verification

1. Create manager → `assigned_phone` populated in DB, shown in admin table
2. Remove manager role → `assigned_phone` stays in DB (not cleared), Twilio not called; schedules + questions soft-deleted; `manager_groups` links deleted (groups themselves survive)
3. Re-promote same user → clean slate (no schedules, no questions, no group assignments); reclaims own number (Step 1 — no Twilio call)
4. Soft-delete manager → number stays on record
5. Create new manager → idle number recycled (Step 2 — no Twilio call)
6. Two managers created simultaneously → both get unique numbers (transaction prevents collision)
7. Set `PHONE_MAX_NUMBERS=1`, create two managers → second is blocked, correct error shown
8. Admin clicks "Assign number" → provisions immediately, number appears in table
9. Manager clicks "Request phone number" → provisions, header updates, buttons enable immediately
10. Manager with no phone number creates a schedule with `active: true` → saved as `active: false`, response includes `warning: 'PHONE_NUMBER_REQUIRED'`
11. Manager with no phone number tries `PATCH /schedules/:id { active: true }` → 422 `PHONE_NUMBER_REQUIRED`
12. Migration SQL: existing active schedules for managers without phone numbers are deactivated
13. Fire broadcast as manager → SMS arrives `From` manager's `assignedPhone`
14. Participant replies → routes to correct manager's conversation
15. Two managers text same participant → each reply routes independently and correctly
16. Kill DB mid-webhook → retries up to `WEBHOOK_RETRY_ATTEMPTS`, then returns 500 to Twilio
17. Unknown number texts the webhook → 200 returned, no crash, warning logged
