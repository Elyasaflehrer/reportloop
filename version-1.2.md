# Version 1.2 — Per-Manager Twilio Phone Numbers

## Background

All managers currently share one global Twilio number (`TWILIO_FROM_NUMBER`). When two managers
send broadcasts to the same participant simultaneously, inbound replies route to whichever
conversation is most recent — arbitrarily wrong. Each manager represents a real person and should
have their own dedicated phone number.

See `manager-phone-strategy.md` for full strategy analysis. Chosen approach: **Option A —
Per-Manager Number + Lazy Reuse**.

---

## How it works (summary)

- Each manager gets their own Twilio number, provisioned automatically
- Inbound replies use `To` (manager's number) + `From` (participant's phone) to route to the correct conversation
- Numbers are **never proactively released** — they stay on the user record and get recycled
- Managers without a dedicated number fall back to the global `TWILIO_FROM_NUMBER` (backward compatible)

### Provisioning trigger

**C1 (eager):** provision at manager creation time — number is ready immediately

**C2 (lazy):** provision only on the manager's first broadcast — zero cost if manager never sends

→ **We implement C1** so the number is visible in the admin UI from day one and ready before the first broadcast.

### Provisioning order (runs on every trigger, in order)

1. Does **this user** already have a `twilioNumber`? → use it directly, no Twilio call
2. Does **any other** non-manager user have an idle `twilioNumber`? → reassign it, no Twilio call
3. Provision a new number from Twilio, configure webhook, store on user

Step 1 handles role-churn: the same user toggled manager → viewer → manager always reclaims their own number.
Step 2 handles recycling: soft-deleted or demoted managers' numbers are reused before buying new ones.

### Number lifecycle

| Event | What happens to the number |
|---|---|
| Manager created (C1) | Provisioning runs (3-step order above) |
| Manager's first broadcast | Number already assigned — used directly |
| Manager role removed | Number stays on user record — eligible for recycling |
| User soft-deleted | Number stays on soft-deleted record — eligible for recycling |
| Inbound SMS to a recycled/idle number | `deletedAt: null` filter finds no active manager → falls back gracefully |

---

## Implementation Steps

### Step 1 — Schema: add `twilioNumber` + `twilioNumberSid` to User

Add two nullable unique fields to the `User` model in `backend/prisma/schema.prisma`:

- `twilioNumber` — the E.164 phone number string (e.g. `+12025551234`)
- `twilioNumberSid` — the Twilio resource SID, needed if a future cleanup job releases idle numbers

Apply to the database via Supabase SQL editor (safe, non-blocking nullable column add):

```sql
ALTER TABLE users ADD COLUMN twilio_number TEXT UNIQUE;
ALTER TABLE users ADD COLUMN twilio_number_sid TEXT UNIQUE;
```

---

### Step 2 — Config: make `TWILIO_FROM_NUMBER` optional

In `backend/src/config.ts`:

- `TWILIO_FROM_NUMBER` becomes an optional fallback — not required for Twilio to be considered configured
- Only `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` are required for the `twilioConfigured` guard
- Update the startup warning to say `TWILIO_FROM_NUMBER` is an optional fallback for managers without a dedicated number

---

### Step 3 — SMS provider: provisioning interface

In `backend/src/services/sms/sms.provider.interface.ts`, add two methods to `ISmsProvider`:

- `provisionNumber(webhookUrl)` → returns `{ number, sid }`
- `releaseNumber(sid)` → void (kept for future cleanup jobs, not called in the main flow)

Also in the same file:

- Add optional `from?` parameter to `sendSms(to, body, from?)`
- Add `to: string` field to `InboundSmsPayload` (the manager's number the participant replied to)

In `backend/src/services/sms/providers/twilio.provider.ts`:

- `provisionNumber`: search for an available US local number, purchase it, configure the webhook URL, return the number and SID. Throw on failure — caller decides how to handle.
- `releaseNumber`: remove the number from Twilio. On failure: log only, do not throw.
- `sendSms`: use `from` if provided, fall back to `this.cfg.fromNumber`. Throw `SmsDeliveryError` if neither is set.
- `parseInboundWebhook`: extract `body.To` and return it as `to` in the payload.

---

### Step 4 — Provisioning service: 3-step recycling logic

Create a helper (or inline in the users route) that implements the 3-step provisioning order:

1. Check if the target user already has a `twilioNumber` → return it, done
2. Find any non-manager user (including soft-deleted) with a `twilioNumber` → reassign it (DB update only, no Twilio call)
3. Call `smsProvider.provisionNumber(webhookUrl)` → store the returned number and SID on the user

This logic runs once: at manager creation (C1).

---

### Step 5 — Broadcast service: send from manager's number

In `backend/src/services/broadcast.service.ts`:

- Extend the schedule select to include `manager.twilioNumber`
- Pass the manager's number down to `processParticipant`
- At the `sendSms` call, pass the manager's number as the `from` argument (falls back to global if null)

---

### Step 6 — Conversation worker: send from manager's number

In `backend/src/jobs/conversation.worker.ts`:

- Extend the include to fetch `schedule.manager.twilioNumber`
- Pass the manager's number as `from` at the `sendSms` call

---

### Step 7 — Reminder worker: send from manager's number

In `backend/src/jobs/reminder.worker.ts`:

- Extend the broadcast select to include `schedule.manager.twilioNumber`
- Pass the manager's number as `from` at the `sendSms` call

---

### Step 8 — Webhook routing: use `To` + `From` together (core fix)

In `backend/src/routes/webhooks.ts`, replace the single-field `From`-only lookup:

1. Find the participant by `From` (participant's phone) — same as today
2. Find the manager by `To` (the number the participant replied to) — new
3. Find the open conversation scoped to that manager — new

When `To` matches no manager (global fallback number), step 2 returns null and the routing falls
back to the old behavior — fully backward compatible.

---

### Step 9 — Users API: trigger provisioning on manager creation

In `backend/src/routes/users.ts`:

**On `POST /users` (create manager):**
- After the user is saved, if `role === 'manager'` and Twilio is configured:
  - Run the 3-step provisioning logic (Step 4)
  - If provisioning fails: log a warning, continue — user is created without a number, falls back to global

**On `PATCH /users/:id` (role change away from manager):**
- Do **nothing** with the number — leave it on the record for recycling
- No Twilio API call, no DB clear

**On all user endpoints (GET /users, GET /users/:id, PATCH /users/:id):**
- Include `twilioNumber` in the select so it is returned to the frontend

---

### Step 10 — Frontend admin UI: show Twilio number

In `frontend/src/types/index.ts`:
- Add `twilioNumber: string | null` to the `User` interface

In `frontend/src/components/admin/AdminUsersTab.tsx`:
- Add a read-only "Twilio #" column to the users table
- Show the provisioned number or "—" if none
- No input field — the number is managed entirely by the backend

---

## Backward Compatibility

| Scenario | Behavior |
|---|---|
| Manager has `twilioNumber` | Uses manager's number — correct routing |
| Manager has no `twilioNumber`, global number set | Falls back to global — same as today |
| Manager has no `twilioNumber`, no global number | `SmsDeliveryError` at send time |
| Two managers each with dedicated numbers text same participant | Each reply routes to the correct manager |

---

## Error Handling

| Event | Behavior |
|---|---|
| Provisioning fails at manager creation | Log warning, continue — user created without number, uses global fallback |
| No available Twilio numbers to provision | Same as above |
| Inbound SMS to a soft-deleted manager's number | No active manager found, falls back gracefully |

---

## Verification

1. Create a manager → confirm a Twilio number is auto-provisioned and shown in the admin table
2. Fire a broadcast as that manager → confirm the SMS arrives `From` the manager's dedicated number
3. Reply to that SMS → confirm it routes to the correct manager's conversation
4. Remove manager role → confirm number stays on the record (not released from Twilio)
5. Create a new manager → confirm the idle number from step 4 is recycled (no new Twilio purchase)
6. Two managers each with dedicated numbers text the same participant → confirm each reply routes correctly
7. Manager without a number (provisioning failed) → confirm fallback to global number works
