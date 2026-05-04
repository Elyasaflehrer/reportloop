# Step 16 — Implementation Plan

Working checklist for implementing inbound webhook routing. Each phase
must complete before the next starts. Delete this file when Step 16 ships.

**References:**
- Spec: `backend/docs/inbound-webhook-routing.md`
- Plan: `version-1.2.md` § Step 16

---

## Phase 1 — Lock down spec gaps (6 decisions)

Six unanswered questions in the spec. Decide each, then backport to the spec.

### D1 — Conversation lookup query

`Conversation` has no `managerId` field. How do we filter by manager?

- **Decided:** Option α — nested relation, no schema change.
  ```ts
  const conversation = await prisma.conversation.findFirst({
    where: {
      userId: participant.id,
      broadcast: { schedule: { managerId: manager.id } },
      status:   { notIn: TERMINAL_STATUSES },
    },
    orderBy: { startedAt: 'desc' },
  })
  ```
- **Why filter by manager:** participant can have open conversations with multiple managers (Case 11). Without the filter, replies route arbitrarily — that's exactly the cross-routing bug Case 9 warns about.
- **Why nested instead of denormalized `managerId` on `Conversation`:** existing indexes cover the join (`schedules.manager_id`, `broadcasts.schedule_id` FK, `conversations.[userId, status]`). Schema stays normalized. Denormalization (Option β) deferred — premature without measured query latency.
- [x] decided

### D2 — STOP / START keywords

Which keywords trigger opt-out / opt-in?

- **Decided:** align fully with Twilio's documented set for US long-codes.
  ```ts
  const OPT_OUT_KEYWORDS = new Set([
    'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT',
  ])
  const OPT_IN_KEYWORDS = new Set([
    'START', 'YES', 'UNSTOP',
  ])

  const isOptOut = (text: string) => OPT_OUT_KEYWORDS.has(text.trim().toUpperCase())
  const isOptIn  = (text: string) => OPT_IN_KEYWORDS.has(text.trim().toUpperCase())
  ```
- **Match rule:** exact match on trimmed + uppercased text. `"STOP"` triggers; `"please stop"` does not.
- **Change from existing:** adds `END` to opt-out set (was missing).
- **HELP / INFO:** not handled in dispatch — processed as regular SMS. If desired, configure Twilio's per-number Auto-Response in the console for help text.
- **Localization:** English-only assumed. Multi-language opt-out keywords (e.g., French `ARRÊT`) deferred.
- [x] decided

### D3 — `handleStatusCallback` algorithm

Which `MessageStatus` values trigger update? What `failReason`? What if message not found?

- **Decided:** mark conversation `failed` on hard delivery failure with a generic reason; defer granular reason classification to future work.

  ```ts
  async function handleStatusCallback(args: {
    smsSid: string
    status: string
    prisma: PrismaClient
    log: Logger
  }) {
    const { smsSid, status, prisma, log } = args

    if (status !== 'failed' && status !== 'undelivered') return

    const message = await prisma.message.findUnique({
      where:  { twilioSid: smsSid },
      select: { conversationId: true },
    })
    if (!message) return

    await prisma.conversation.updateMany({
      where: {
        id:     message.conversationId,
        status: { notIn: ['completed'] },
      },
      data: {
        status:     'failed',
        failedAt:   new Date(),
        failReason: 'TWILIO_DELIVERY_FAILED',
      },
    })

    log.info(
      { smsSid, status, conversationId: message.conversationId },
      '[webhook] outbound delivery failed — conversation marked failed'
    )
  }
  ```

- **Status filter:** only `failed` + `undelivered` act. All other statuses (`queued`, `sending`, `sent`, `delivered`, `read`) → no-op.
- **`failReason`:** generic `'TWILIO_DELIVERY_FAILED'` — same string for both failure types. Future work: parse Twilio's `ErrorCode` field for granular reasons (e.g., `INVALID_NUMBER`, `CARRIER_BLOCKED`).
- **Message not found:** silent return — nothing actionable.
- **Case 28 guard preserved:** `status: { notIn: ['completed'] }` prevents overwriting a completed conversation with a late-arriving failure callback.
- **Observability:** info-level log on every action, including `conversationId` for direct lookup.
- [x] decided

### D4 — `handleOptOut` algorithm

Participant lookup query? `failReason` on conversations? Behavior if user not found?

- **Decided:**

  ```ts
  async function handleOptOut(args: {
    from: string
    prisma: PrismaClient
    log: Logger
  }) {
    const { from, prisma, log } = args

    const user = await prisma.user.findFirst({
      where:  { phone: from, deletedAt: null },
      select: { id: true },
    })
    if (!user) {
      log.info({ from }, '[webhook] opt-out from unknown number — ignored')
      return
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data:  { smsOptedOut: true },
      }),
      prisma.conversation.updateMany({
        where: {
          userId: user.id,
          status: { notIn: TERMINAL_STATUSES },
        },
        data: {
          status:     'failed',
          failedAt:   new Date(),
          failReason: 'OPT_OUT',
        },
      }),
    ])

    log.info({ from, userId: user.id }, '[webhook] participant opted out')
  }
  ```

- **Lookup:** `findFirst { phone: from, deletedAt: null }` — ignores soft-deleted users.
- **`failReason`:** `'OPT_OUT'` — matches existing code, clear in DB.
- **User not found:** log at info level (was originally proposed as silent return — added log for diagnostic visibility per user choice). Enables tracking of opt-outs from unknown numbers (could be number-changed-but-DB-stale, or real unknown sender).
- **Atomicity:** `$transaction` array form — both ops independent, no callback form needed. Implements Case 29 (STOP must be atomic).
- **Scope:** failed across ALL managers (global opt-out per D2). Per-number opt-out deferred to v2.
- [x] decided

### D5 — Terminal statuses constant

Define "terminal" once. A conversation is **terminal** when it's permanently closed — no more messages will be processed on it.

- **Decided:**
  ```ts
  const TERMINAL_STATUSES = ['completed', 'failed', 'timed_out', 'superseded'] as const
  ```
- **Active (non-terminal) statuses:** `pending`, `awaiting_reply`, `processing` — conversation still in flight.
- **Terminal statuses:** `completed` (success), `failed` (delivery error / opt-out), `timed_out` (no reply in window), `superseded` (replaced by newer broadcast).
- **Used by:** `handleOptOut` (find open conversations to fail), `handleRegularMessage` Step 4 (find active conversation for participant + manager).
- **`as const` gives:** literal-string tuple type → autocomplete + compile-time typo prevention + Prisma `ConversationStatus` enum compatibility.
- **Location:** top of `inbound.worker.ts` — only used here. Promote to shared module only if another worker needs it.
- [x] decided

### D6 — Reason code for `failed` status during lock fail

Spec lists 4 reason codes but doesn't cover the case where `conversation.status === 'failed'` when the lock attempt fails. Pick a code.

- **Decided:** add `SESSION_FAILED` for symmetry with the other terminal statuses.
  ```ts
  const REASON_BY_STATUS = {
    processing:  'OUT_OF_TURN',
    completed:   'SESSION_COMPLETED',
    timed_out:   'SESSION_TIMED_OUT',
    superseded:  'SESSION_SUPERSEDED',
    failed:      'SESSION_FAILED',
  } as const
  ```
- **Why a distinct code:** keeps audit logs honest. `SESSION_FAILED` tells future-debugger the reply hit a killed conversation (delivery error, opt-out, admin action), not an out-of-turn one. Folding into `OUT_OF_TURN` would lose that signal.
- **Real-world triggers:** participant texted STOP then immediately replied (race); Twilio status callback marked failed just before reply; admin action.
- **Used by:** `handleRegularMessage` Step 7 — when the `$transaction` lock returns `count === 0`, look up `conversation.status` and use this map for the audit log reason.
- [x] decided

---

## Phase 2 — Module-shape decisions (4 decisions)

### D7 — File layout

- **Decided:** single file `backend/src/jobs/inbound.worker.ts` (~350 LOC) with `// ─── Section ───` comments matching `webhooks.ts` style.
- **Why single file:**
  - Matches existing convention — `conversation.worker.ts` and `reminder.worker.ts` are single files. Folder-split would break the pattern in `backend/src/jobs/`.
  - Handlers are one concern (process inbound webhook payloads), not separate ones — splitting hides the coupling instead of decoupling anything.
  - 350 LOC is well under the "painful threshold" (~600–800 LOC). Scrolling beats tab-switching at this size.
- **Section structure:**
  ```
  ─── Imports
  ─── Constants (TERMINAL_STATUSES, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS, REASON_BY_STATUS)
  ─── Types (InboundJob)
  ─── Helpers (isOptOut, isOptIn, safeAuditLog)
  ─── Handler: handleStatusCallback
  ─── Handler: handleOptOut
  ─── Handler: handleOptIn
  ─── Handler: handleRegularMessage
  ─── Worker factory + dispatch (startInboundWorker)
  ```
- **Promote to folder split** only if worker passes ~600 LOC during implementation, OR if 5+ inbound webhooks (Stripe, Slack, etc.) get added in the future and a multi-provider convention emerges.
- [x] decided

### D8 — Worker concurrency

- **Decided:** env-driven, default `5`.
- **Config schema** (add to `backend/src/config.ts`):
  ```ts
  inboundWorker: z.object({
    concurrency: z.coerce.number().int().min(1).max(50).default(5),
  })
  ```
- **Env var:** `INBOUND_WORKER_CONCURRENCY`
- **Worker registration:**
  ```ts
  new Worker('inbound', processFn, {
    connection:  redis,
    concurrency: config.inboundWorker.concurrency,
  })
  ```
- **Per-environment:**
  - `.env.local` (dev): `INBOUND_WORKER_CONCURRENCY=1` — easier to debug sequentially
  - prod / staging: unset → uses default `5`
- **Why safe at concurrency > 1:** `handleStatusCallback` operates on independent rows (per-message); `handleOptOut` / `handleOptIn` are protected by PostgreSQL row-level locks via `$transaction`; `handleRegularMessage` uses our own atomic `updateMany` lock + `$transaction` (Case 13). Race conditions are eliminated by the lock layer.
- **When to tune:**
  - Bump → 10 if inbound queue regularly has > 50 waiting jobs
  - Bump → higher when adding WhatsApp or other channels
  - Drop → 1–2 if Prisma connection pool runs hot
- [x] decided

### D9 — Handler signature shape

- **Decided:** Option α — per-handler args object, each handler takes only what it needs.
  ```ts
  async function handleStatusCallback(args: {
    smsSid: string; status: string;
    prisma: PrismaClient; log: Logger;
  }) { ... }

  async function handleOptOut(args: {
    from: string;
    prisma: PrismaClient; log: Logger;
  }) { ... }

  async function handleOptIn(args: {
    from: string;
    prisma: PrismaClient; log: Logger;
  }) { ... }

  async function handleRegularMessage(args: {
    from: string; to: string; text: string; smsSid: string;
    prisma: PrismaClient; log: Logger;
  }) { ... }
  ```
- **Why α over β (shared mega-context):** β makes every field optional → TypeScript can't catch "forgot to pass `from`". α gets compile-time safety: missing required field = build error.
- **Why α over γ (DI factory):** γ adds an indirection layer that pays off only with many handlers (~10+). For 4 handlers, the "boilerplate" cost is 4 lines in the dispatcher — trivial:
  ```ts
  if (status)          return handleStatusCallback({ smsSid, status, prisma, log })
  if (isOptOut(text))  return handleOptOut({ from, prisma, log })
  if (isOptIn(text))   return handleOptIn({ from, prisma, log })
  return handleRegularMessage({ from, to, text, smsSid, prisma, log })
  ```
- **Senior heuristic applied:** prefer simplest pattern that gives static safety. α does.
- [x] decided

### D10 — Transaction control flow (lock + `message.create`)

- **Decided:** Option β — discriminated return value from the transaction callback. No sentinel-error throwing for control flow.

  ```ts
  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      const lock = await tx.conversation.updateMany({
        where: { id: conversation.id, status: 'awaiting_reply' },
        data:  { status: 'processing', lastMessageAt: new Date() },
      })

      if (lock.count === 0) {
        const current = await tx.conversation.findUnique({
          where:  { id: conversation.id },
          select: { status: true },
        })
        return { locked: false, currentStatus: current!.status } as const
      }

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          role:           'participant',
          body:           text,
          twilioSid:      smsSid,
        },
      })
      return { locked: true } as const
    })
  } catch (err) {
    if (isPrismaP2000(err)) {
      log.warn({ smsSid, len: text.length }, '[webhook] body too long — discarded')
      return
    }
    throw err  // BullMQ retries
  }

  if (!result.locked) {
    await safeAuditLog(prisma, log, {
      fromPhone: from,
      toPhone:   to,
      reason:    REASON_BY_STATUS[result.currentStatus],
    })
    return
  }

  await conversationQueue.add('process', { conversationId: conversation.id })
  ```

- **Why β over α (sentinel error):**
  - "Errors mean errors" — lock-not-acquired is an *expected* outcome (predictable on conversation state transitions), not exceptional. Throwing for it blurs `try/catch` semantics.
  - β reads top-to-bottom. α requires reader to mentally jump between try and catch blocks to follow flow.
  - Discriminated unions (`{ locked: true } | { locked: false; currentStatus }`) are TypeScript's idiomatic pattern for this exact case — compile-time exhaustiveness checking.
  - β's catch block has one job (real errors). α's mixes control flow + real errors.
  - Industry direction (tRPC, Vercel, Effect-TS, neverthrow) favors result-returning over exception-as-control-flow.
- **What lock + transaction enforces:** "one conversation processes replies one at a time; subsequent replies while in `processing` are dropped with audit log." Implements out-of-turn rule (Case 3) + recovers from `message.create` failures (Case 13).
- **`isPrismaP2000` helper:** small type guard for the body-too-long case (Case 18).
- [x] decided

---

## Phase 3 — Spec backport (after Phase 1 + 2)

Update `backend/docs/inbound-webhook-routing.md` to reflect the decisions:

- [x] Routing & lookup chain Step 4 — fix query syntax (nested relation, D1)
- [x] Special handlers § STOP/START — add keyword tables (D2)
- [x] Special handlers § Status callback — add statuses + `failReason` (D3)
- [x] Special handlers § STOP/START — add lookup query + `failReason` for `handleOptOut` (D4)
- [x] Special handlers § Out-of-turn — add `TERMINAL_STATUSES` constant + `SESSION_FAILED` (D5, D6)
- [x] File specification — note the worker concurrency choice + handler signature shape (D8, D9)

---

## Phase 4 — Pre-coding cleanup

- [x] Trim Step 16 in `version-1.2.md` to 16a/16b commit boundaries + checkboxes + pointer to spec
- [x] Delete `Test — Section E` from `version-1.2.md` (lives in spec doc now)

---

## Phase 5 — Coding (in dependency order)

### 5.1 — Schema migration (Sub-step 16a)

- [ ] Add `toPhone String? @map("to_phone")` to `InboundAuditLog` in `prisma/schema.prisma`
- [ ] Apply SQL in Supabase: `ALTER TABLE inbound_audit_logs ADD COLUMN to_phone TEXT`
- [ ] Run `npx prisma generate`
- [ ] Commit 16a

### 5.2 — Queue declaration

`backend/src/jobs/queue.ts`

- [x] Add `inboundQueue` (name `'inbound'`, same connection)
- [x] `removeOnComplete: { count: 200 }`, `removeOnFail: { count: 500 }`
- [x] `attempts: 5`, `backoff: { type: 'exponential', delay: 1000 }`

### 5.3 — Worker (NEW file)

`backend/src/jobs/inbound.worker.ts` — section by section:

- [x] Imports + `InboundJob` type
- [x] Constants — `TERMINAL_STATUSES`, `OPT_OUT_KEYWORDS`, `OPT_IN_KEYWORDS`, `REASON_BY_STATUS`
- [x] Helpers — `isOptOut(text)`, `isOptIn(text)`, `safeAuditLog(data)`, `isPrismaP2000(err)`
- [x] `handleStatusCallback({ smsSid, status })`
- [x] `handleOptOut({ from })`
- [x] `handleOptIn({ from })`
- [x] `handleRegularMessage({ from, to, text, smsSid })`
- [x] `startInboundWorker()` — factory with dispatch

### 5.4 — Webhook route (REWRITE)

`backend/src/routes/webhooks.ts`

- [x] Delete old `handleInboundSms` and `handleStatusCallback` from this file
- [x] Register route with `config: { rateLimit: false }`
- [x] Signature validation try/catch → 403
- [x] Field extraction
- [x] Guards: missing fields, MMS
- [x] Enqueue try/catch → 500 on Redis fail
- [x] Return 200

### 5.5 — Worker registration

`backend/src/index.ts`

- [x] Call `startInboundWorker()` alongside existing workers
- [x] Guard with `if (config.twilio)` (matches reminder worker pattern)
- [x] Add to graceful shutdown sequence

### 5.6 — Verify build

- [x] `npx tsc --noEmit` clean (caught + fixed: `TERMINAL_STATUSES` `as const` → mutable array)
- [x] No ESLint configured for backend; typecheck is the build gate

---

## Phase 6 — Tests *(deferred)*

E2E setup is non-trivial right now (ngrok + real Twilio number + test participant). Pragmatic call: skip Phase 6, treat as a follow-up task after E2E infra is ready.

Smoke test (`npm run dev`) confirmed clean boot of the inbound worker — that's the build-gate equivalent for now.

**Deferred test layers (in priority order for the follow-up):**

### 6.1 — Unit tests (no DB) — *quick wins, ~10 min*
- [ ] `isOptOut` keyword table — 6 keywords × case variants + 2 negatives
- [ ] `isOptIn` keyword table — 3 keywords × case variants + 2 negatives
- [ ] `safeAuditLog` swallows DB errors and logs warning

### 6.2 — Handler tests (mocked prisma) — *low signal, skip*
Mocked Prisma tests mostly verify the test mirrors the implementation. Real coverage comes from E2E.

### 6.3 — End-to-end (the real gate)
- [ ] Happy path — real SMS → DB record
- [ ] Two managers, same participant — no cross-routing
- [ ] Unknown participant — 200 + audit log
- [ ] Unknown manager — 200 + warn log
- [ ] Transient DB error — BullMQ retries 5×, then `failed` state

---

## Phase 7 — Commit + close

- [ ] Commit 16b: queue + worker + route + index — single end-to-end change
- [ ] Tick `[ ] 16a` and `[ ] 16b` checkboxes in `version-1.2.md`
- [ ] Delete this file

---

## Open questions to confirm during coding

- BullMQ option location — `removeOnComplete` may be queue-level only; verify against existing `conversationQueue`
- Logger source — `req.log` (route) vs `job.log` (worker) vs `pino` instance from deps; pick one consistently
- Mock Redis path — verify enqueue works in dev where Redis is mocked
- `parseInboundWebhook` on `ISmsProvider` — keep for backward compat or delete? Decision needed before 5.4
