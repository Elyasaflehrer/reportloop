# Resume — Last Session

## Where We Are

Version 1.2 — Per-Manager Phone Numbers. **All 29 webhook edge cases reviewed and decided. Ready to implement Step 16.**

---

## Completed Steps This Session

| Step | File | Status |
|---|---|---|
| 7 | `phone-number.service.ts` — 3-step `provisionForManager` | ✅ Done |
| 8 | `manager.service.ts` — `onManagerCreated` | ✅ Done |
| 9 | `rbac.ts` — `assignedPhone` in `AuthUser` + DB select | ✅ Done |
| 10 | `app.ts` — `smsProvider` created once, passed to routes | ✅ Done |
| 11 | `users.ts` — `smsProvider` opts, provision on create/promote, `POST /users/:id/provision-number` | ✅ Done |
| 11a | `schedules.ts` — activation guard (422 `NO_PHONE_NUMBER`) | ✅ Done |
| 11b | `manager.service.ts` + `users.ts` — manager demotion cleanup | ✅ Done |
| 16 (planning) | All 29 edge cases reviewed + decided in `version-1.2.md` | ✅ Done |

---

## Step 16 Architecture Decisions

### Two-queue async
Webhook returns 200 immediately after persisting to Redis. No 15s timeout risk. BullMQ retries handle all failures.

```
Twilio → webhooks.ts → inboundQueue (Redis) → return 200
                              ↓
                     inbound.worker.ts
                       ├── handleOptOut        ($transaction)
                       ├── handleOptIn
                       ├── handleStatusCallback
                       └── handleRegularMessage → conversationQueue
                                                        ↓
                                               conversation.worker.ts
```

### File structure

| File | What |
|---|---|
| `backend/src/routes/webhooks.ts` | Signature validation (try/catch → 403), field extraction, MMS guard, missing field guard (`!from \|\| !to \|\| !smsSid`), enqueue to `inboundQueue` with `jobId: smsSid`, return 200 |
| `backend/src/jobs/inbound.worker.ts` | All business logic — see handlers below |
| `backend/src/jobs/queue.ts` | Add `inboundQueue` alongside `conversationQueue` |
| `backend/prisma/schema.prisma` | Add `toPhone String? @map("to_phone")` to `InboundAuditLog` |

### `webhooks.ts` — route handler shape

```ts
// 1. Signature validation
try {
  if (!smsProvider.validateWebhookSignature(req)) return reply.status(403).send()
} catch { return reply.status(403).send() }

// 2. Extract fields
const raw    = req.body as Record<string, string>
const from   = raw.From          ?? ''
const to     = raw.To            ?? ''
const text   = (raw.Body ?? '').trim()
const smsSid = raw.MessageSid ?? raw.SmsSid ?? ''
const status = raw.MessageStatus ?? ''

// 3. Guards
if (!from || !to || !smsSid) {
  req.log.warn({ from, to, smsSid }, '[webhook] missing required fields')
  return reply.status(200).send()
}
if (parseInt(raw.NumMedia ?? '0') > 0) {
  req.log.info({ from, to, smsSid }, '[webhook] MMS not supported — discarded')
  return reply.status(200).send()
}

// 4. Enqueue + return
await inboundQueue.add('inbound', { from, to, text, smsSid, status }, { jobId: smsSid })
return reply.status(200).send()
```

### `inbound.worker.ts` — handler decisions

**`handleOptOut(from)`**
- Find participant
- `$transaction`: `user.update` smsOptedOut: true + `conversation.updateMany` status: failed (Case 29)

**`handleOptIn(from)`**
- Find participant
- `user.update` smsOptedOut: false

**`handleStatusCallback(smsSid, status)`**
- Only act on `failed` / `undelivered`
- Find message by smsSid
- `conversation.update` with `status: { notIn: ['completed'] }` guard (Case 28)

**`handleRegularMessage(from, to, text, smsSid, log)`**
- Guard: `!text` → `log.debug` + return (Case 21)
- Idempotency: `message.findUnique({ twilioSid: smsSid })` → if found, `log.warn` + return (Case 1)
- Find participant by `from` → if null, `inboundAuditLog` (toPhone included) + return (Case 4)
- Check `smsOptedOut` → if true, `log.info` + return (Case 12)
- Find manager by `{ assignedPhone: to, role: 'manager', deletedAt: null }` → if null, `log.info` + debug detail query (Cases 7, 8)
- Find conversation by `{ userId, managerId, status not terminal }` → if null, `log.warn` + return (Cases 5, 9, 11)
- `$transaction`: lock (`updateMany status: awaiting_reply → processing`) + `message.create` — if lock fails (count=0), granular reason codes (Case 3); if P2000, `log.warn` + return (Case 18)
- Enqueue to `conversationQueue`
- All `inboundAuditLog.create` calls wrapped in `.catch(err => log.warn(...))` (Case 27)

### Key edge case decisions

| Case | Decision |
|---|---|
| 1 — Duplicate SID | `log.warn` + return 200 |
| 2 — STOP/START | Global opt-out. `handleOptOut` + `handleOptIn` functions. `$transaction` for atomicity |
| 3 — Out-of-turn | Granular reason codes: `OUT_OF_TURN`, `SESSION_COMPLETED`, `SESSION_TIMED_OUT`, `SESSION_SUPERSEDED` |
| 4 — Unknown participant | `UNKNOWN_PARTICIPANT` reason, `log.warn`, return 200 |
| 5 — No open conversation | `log.warn` + return. Future: participant-initiated conversation hook |
| 7/8 — Unknown manager number | `log.info` + debug query for reason (soft-deleted / demoted / not in system) |
| 10 — Transient DB error | BullMQ retries — no `withRetry` needed |
| 12 — Opted-out sends regular message | `log.info` (Twilio auto-replies) + return. Explicit check before Case 5 |
| 13 — Stuck in processing | Fixed: `$transaction` wraps lock + `message.create` — rollback on failure |
| 14 — Rate limiter | Exempt `/webhooks/twilio` with `config: { rateLimit: false }` |
| 18 — Body too long | Catch `P2000` → `log.warn` + return (no retry) |
| 19 — Redis down mid-worker | Still deferred — needs cleanup job |
| 20 — Number recycled | Handled by `managerId` filter → falls to Case 5 |
| 21 — Empty body | `log.debug` + return silently |
| 22 — toPhone in audit log | Include now — add `toPhone` column to `InboundAuditLog` |
| 24 — Pre-migration replies | N/A — first deployment |
| 26 — MMS | Rejected at route level — `NumMedia > 0` → `log.info` + return 200 |
| 28 — Status callback overwrites completed | `status: { notIn: ['completed'] }` guard |
| 29 — STOP not atomic | `$transaction` in `handleOptOut` |

---

## Next Step

**Implement Step 16** — in this order:

1. `prisma/schema.prisma` — add `toPhone` to `InboundAuditLog` + migration
2. `jobs/queue.ts` — add `inboundQueue`
3. `routes/webhooks.ts` — rewrite with extraction + guards + enqueue
4. `jobs/inbound.worker.ts` — new file with all handlers

---

## Remaining Steps

| Step | What |
|---|---|
| 16 | Webhook routing — **ready to implement** |
| 17 | Frontend types + session context |
| 18 | Admin dashboard UI |
| 19 | Manager dashboard UI |

---

## Architecture Patterns

- **`manager.service.ts`** owns full manager lifecycle: `onManagerDemoted` (top) + `onManagerCreated` (bottom)
- **`userSelect` const** in `users.ts` — single source of truth for user HTTP response shape
- **Dependency injection** — `smsProvider` passed as parameter, never imported directly in routes
- **Typed errors** — `ProvisionLimitError` (`PHONE_LIMIT_REACHED`), `ProvisionFailedError` (`PROVISION_FAILED`)
- **Two-queue async** — webhook enqueues to `inboundQueue`, worker processes and enqueues to `conversationQueue`
- **`$transaction` callback form** — `tx` used inside, NOT `prisma` directly
- **Route = policy, service/worker = logic** — routes stay thin, all business logic in workers/services

---

## Key Files

| File | Purpose |
|---|---|
| `version-1.2.md` | Full implementation plan with all 29 edge case decisions |
| `manager-phone-strategy.md` | Architecture decisions and lifecycle table |
| `backend/src/services/manager.service.ts` | `onManagerDemoted` + `onManagerCreated` |
| `backend/src/services/sms/phone-number.service.ts` | `provisionForManager` 3-step logic |
| `backend/src/routes/users.ts` | `userSelect`, PATCH demotion/promotion flow |
| `backend/src/routes/schedules.ts` | Activation guard |
| `backend/src/routes/webhooks.ts` | **Next file to rewrite** |
| `backend/src/jobs/inbound.worker.ts` | **Next file to create** |
| `backend/src/jobs/queue.ts` | Add `inboundQueue` |
