import { Worker } from 'bullmq'
import { Prisma, type ConversationStatus } from '@prisma/client'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { conversationQueue, defaultWorkerOpts } from './queue.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InboundJob = {
  from:   string   // participant's phone (E.164)
  to:     string   // manager's assignedPhone (E.164)
  text:   string   // trimmed body — empty for status callbacks
  smsSid: string   // Twilio SID — used as BullMQ jobId for deduplication
  status: string   // non-empty = status callback, empty = inbound SMS
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: ConversationStatus[] = [
  'completed', 'failed', 'timed_out', 'superseded',
]

// Aligned with Twilio's documented opt-out / opt-in keyword set for US long-codes.
const OPT_OUT_KEYWORDS = new Set([
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT',
])
const OPT_IN_KEYWORDS = new Set([
  'START', 'YES', 'UNSTOP',
])

// Maps the conversation's current status (when the lock fails) to an audit-log
// reason code. Every ConversationStatus is covered so TypeScript catches
// changes to the enum at compile time.
const REASON_BY_STATUS: Record<ConversationStatus, string> = {
  pending:        'OUT_OF_TURN',
  awaiting_reply: 'OUT_OF_TURN',  // shouldn't reach here — the lock would succeed
  processing:     'OUT_OF_TURN',
  completed:      'SESSION_COMPLETED',
  timed_out:      'SESSION_TIMED_OUT',
  superseded:     'SESSION_SUPERSEDED',
  failed:         'SESSION_FAILED',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isOptOut = (text: string) => OPT_OUT_KEYWORDS.has(text.trim().toUpperCase())
const isOptIn  = (text: string) => OPT_IN_KEYWORDS.has(text.trim().toUpperCase())

// Audit-log writes must never crash the worker. Wraps every inboundAuditLog.create
// call so a logging-failure can't trigger BullMQ retries for a non-critical write.
async function safeAuditLog(data: {
  fromPhone:      string
  toPhone?:       string
  body:           string
  conversationId?: number
  reason:         string
}) {
  try {
    await prisma.inboundAuditLog.create({ data })
  } catch (err) {
    console.warn('[inbound-worker] audit log write failed:', err)
  }
}

// Type guard for Prisma's "value too long for the column type" error.
// Used to drop messages that exceed the DB body column without retrying.
function isPrismaP2000(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2000'
}

// ─── Handler: handleStatusCallback ────────────────────────────────────────────
// Twilio delivery callbacks for outbound SMS we sent earlier. Marks the
// conversation as failed when the carrier never delivered our message.
// Only acts on hard failures (failed / undelivered) — happy-path statuses
// like delivered / sent are no-ops.

async function handleStatusCallback(args: {
  smsSid: string
  status: string
}) {
  const { smsSid, status } = args

  // Skip happy-path / transient statuses
  if (status !== 'failed' && status !== 'undelivered') return

  // Find the outbound message this callback refers to
  const message = await prisma.message.findUnique({
    where:  { twilioSid: smsSid },
    select: { conversationId: true },
  })
  if (!message) return  // unknown message — silent

  // Mark conversation failed. Case 28 guard prevents overwriting a
  // late-arriving callback when the conversation is already completed.
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

  console.info(
    `[inbound-worker] outbound delivery failed — conversation ${message.conversationId} marked failed (smsSid=${smsSid}, status=${status})`,
  )
}

// ─── Handler: handleOptOut ────────────────────────────────────────────────────
// Participant texted a STOP-family keyword. Globally opts them out of the
// platform and fails all their active conversations atomically. STOP from
// any manager number applies platform-wide — per-number opt-out is deferred
// to v2.

async function handleOptOut(args: { from: string }) {
  const { from } = args

  const user = await prisma.user.findFirst({
    where:  { phone: from, deletedAt: null },
    select: { id: true },
  })
  if (!user) {
    console.info(`[inbound-worker] opt-out from unknown number ${from} — ignored`)
    return
  }

  // Atomic: opt-out flag + active-conversation cancellation. Without the
  // transaction, a failed updateMany would leave the participant opted out
  // while workers keep sending to active conversations.
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

  console.info(`[inbound-worker] participant ${user.id} opted out (from=${from})`)
}

// ─── Handler: handleOptIn ─────────────────────────────────────────────────────
// Participant texted a START-family keyword. Re-enables outbound SMS for
// them. Does NOT re-open conversations that were killed by a previous STOP —
// any new outreach must start a fresh conversation.

async function handleOptIn(args: { from: string }) {
  const { from } = args

  const user = await prisma.user.findFirst({
    where:  { phone: from, deletedAt: null },
    select: { id: true },
  })
  if (!user) return  // silent return — per spec

  await prisma.user.update({
    where: { id: user.id },
    data:  { smsOptedOut: false },
  })

  console.info(`[inbound-worker] participant ${user.id} opted back in (from=${from})`)
}

// ─── Handler: handleRegularMessage ────────────────────────────────────────────
// Participant reply to a manager's broadcast. Validates, routes to the right
// conversation, locks it atomically, persists the message, and enqueues
// downstream AI processing. The dense path of the worker.

async function handleRegularMessage(args: {
  from:   string
  to:     string
  text:   string
  smsSid: string
}) {
  const { from, to, text, smsSid } = args

  // ── Step 1: empty body guard (Case 21) ──────────────────────────────────────
  // Whitespace-only or empty bodies would feed the AI no input. Drop silently.
  if (!text) {
    console.debug(`[inbound-worker] empty body discarded (smsSid=${smsSid})`)
    return
  }

  // ── Step 2: duplicate SID check — Layer 2 idempotency (Case 1) ──────────────
  // Layer 1 is BullMQ's jobId: smsSid (catches in-queue duplicates). This
  // catches delayed Twilio retries that arrive after the job already cleared.
  const duplicate = await prisma.message.findUnique({
    where:  { twilioSid: smsSid },
    select: { id: true },
  })
  if (duplicate) {
    console.warn(`[inbound-worker] duplicate Twilio SID ${smsSid} — already processed`)
    return
  }

  // ── Step 3: find the participant by sender phone (Case 4) ───────────────────
  const participant = await prisma.user.findFirst({
    where:  { phone: from, deletedAt: null },
    select: { id: true, smsOptedOut: true },
  })
  if (!participant) {
    await safeAuditLog({
      fromPhone: from,
      toPhone:   to,
      body:      text,
      reason:    'UNKNOWN_PARTICIPANT',
    })
    return
  }

  // ── Step 4: opted-out check (Case 12) ───────────────────────────────────────
  // Must run before Step 6 so the log shows the right reason. Twilio already
  // auto-replies "You have opted out. Reply START to resubscribe." — outbound
  // is blocked from our side anyway, so we just log and return.
  if (participant.smsOptedOut) {
    console.info(
      `[inbound-worker] message from opted-out participant ${participant.id} — handled by Twilio auto-reply (from=${from})`,
    )
    return
  }

  // ── Step 5: find the manager whose number the message arrived at (Cases 7, 8)
  const manager = await prisma.user.findFirst({
    where:  { assignedPhone: to, role: 'manager', deletedAt: null },
    select: { id: true },
  })
  if (!manager) {
    console.info(
      `[inbound-worker] inbound to unknown manager number ${to} (from=${from}, smsSid=${smsSid})`,
    )

    // Debug-only: explain WHY no manager matched.
    if (config.log_level === 'debug') {
      const candidate = await prisma.user.findFirst({
        where:  { assignedPhone: to },
        select: { id: true, role: true, deletedAt: true },
      })
      if (!candidate) {
        console.debug(`[inbound-worker]   reason: number ${to} not assigned to any user`)
      } else if (candidate.deletedAt) {
        console.debug(`[inbound-worker]   reason: number ${to} belongs to soft-deleted user ${candidate.id}`)
      } else if (candidate.role !== 'manager') {
        console.debug(`[inbound-worker]   reason: number ${to} belongs to user ${candidate.id} with role '${candidate.role}'`)
      }
    }
    return
  }

  // ── Step 6: find the open conversation (Case 5) ─────────────────────────────
  // Conversation has no managerId — reach manager via the nested relation.
  // orderBy startedAt desc selects the most recent if (unexpectedly) multiple
  // open conversations exist with the same manager.
  const conversation = await prisma.conversation.findFirst({
    where: {
      userId:    participant.id,
      broadcast: { schedule: { managerId: manager.id } },
      status:    { notIn: TERMINAL_STATUSES },
    },
    orderBy: { startedAt: 'desc' },
    select:  { id: true },
  })
  if (!conversation) {
    console.warn(
      `[inbound-worker] no open conversation for participant ${participant.id} (from=${from}, to=${to})`,
    )
    return
  }

  // ── Step 7: atomic lock + message persist (Cases 3, 13, 18) ─────────────────
  // β-pattern (D10): discriminated return — lock-fail is a normal outcome,
  // not an exception. try/catch is only for actual errors (P2000, real DB
  // failures).
  let result: { locked: true } | { locked: false; currentStatus: ConversationStatus }
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
      console.warn(
        `[inbound-worker] body too long — discarded (smsSid=${smsSid}, len=${text.length})`,
      )
      return  // BullMQ marks job complete, no retry
    }
    throw err  // unexpected — BullMQ retries
  }

  // ── Out-of-turn audit log (Case 3) ──────────────────────────────────────────
  if (!result.locked) {
    await safeAuditLog({
      fromPhone:      from,
      toPhone:        to,
      body:           text,
      conversationId: conversation.id,
      reason:         REASON_BY_STATUS[result.currentStatus],
    })
    return
  }

  // ── Step 8: enqueue AI processing ──────────────────────────────────────────
  // Known gap deferred to v2: if Redis goes down here the message is saved
  // but downstream never fires. runStuckRecovery in reminder.worker.ts resets
  // the status but doesn't re-enqueue.
  await conversationQueue.add(
    'process',
    { conversationId: conversation.id },
    { jobId: `conv:${conversation.id}:${smsSid}` },
  )
}

// ─── Worker factory + dispatch ────────────────────────────────────────────────
// Started from index.ts at app boot when Twilio is configured. Dispatches
// inbound jobs by message type:
//   1. Status callbacks (MessageStatus set, no Body)
//   2. STOP-family keywords  → handleOptOut
//   3. START-family keywords → handleOptIn
//   4. Everything else       → handleRegularMessage

export function startInboundWorker() {
  const worker = new Worker<InboundJob>(
    'inbound',
    async (job) => {
      const { from, to, text, smsSid, status } = job.data

      // Status callbacks first — no text content, distinct payload type.
      if (status) {
        return handleStatusCallback({ smsSid, status })
      }

      // Opt-out / opt-in keyword dispatch before regular routing.
      if (isOptOut(text)) {
        return handleOptOut({ from })
      }
      if (isOptIn(text)) {
        return handleOptIn({ from })
      }

      // Default — participant reply to a manager's broadcast.
      return handleRegularMessage({ from, to, text, smsSid })
    },
    {
      ...defaultWorkerOpts,
      concurrency: config.inboundWorker.concurrency,
    },
  )

  worker.on('failed', (job, err) => {
    console.error(
      `[inbound-worker] job ${job?.id} failed (smsSid=${job?.data?.smsSid}): ${err.message}`,
    )
  })

  console.info(
    `[inbound-worker] started — concurrency ${config.inboundWorker.concurrency}`,
  )

  return worker
}
