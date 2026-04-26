import { type FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { conversationQueue } from '../jobs/queue.js'
import type { ISmsProvider } from '../services/sms/sms.provider.interface.js'

export async function webhooksRoutes(app: FastifyInstance, opts: { smsProvider: ISmsProvider }) {
  const { smsProvider } = opts

  // ─── POST /webhooks/twilio ─────────────────────────────────────────────────
  // Handles both inbound SMS (Body param) and delivery status callbacks (MessageStatus param).
  // Returns 200 immediately — real work is enqueued to avoid Twilio's 15s timeout.

  app.post('/webhooks/twilio', async (req, reply) => {
    // Signature validation — reject anything not from Twilio
    if (!smsProvider.validateWebhookSignature(req)) {
      return reply.status(403).send({ error: 'Invalid Twilio signature' })
    }

    const body = req.body as Record<string, string>

    // ── Status callback (delivery failure) ──────────────────────────────────
    if (body.MessageStatus && !body.Body) {
      await handleStatusCallback(body)
      return reply.status(200).send()
    }

    // ── Inbound SMS ──────────────────────────────────────────────────────────
    if (body.Body) {
      await handleInboundSms(body, smsProvider)
      return reply.status(200).send()
    }

    return reply.status(200).send()
  })
}

// ─── Inbound SMS handler ──────────────────────────────────────────────────────

async function handleInboundSms(
  body:        Record<string, string>,
  smsProvider: ISmsProvider,
) {
  const from    = body.From    // E.164 phone number
  const text    = (body.Body ?? '').trim()
  const smsSid  = body.MessageSid

  // ── Opt-out / opt-in handling ──────────────────────────────────────────────
  const upperText = text.toUpperCase()

  if (upperText === 'STOP' || upperText === 'STOPALL' || upperText === 'UNSUBSCRIBE' || upperText === 'CANCEL' || upperText === 'QUIT') {
    const user = await prisma.user.findFirst({ where: { phone: from, deletedAt: null } })
    if (user) {
      await prisma.user.update({ where: { id: user.id }, data: { smsOptedOut: true } })
      await prisma.conversation.updateMany({
        where: { userId: user.id, status: { notIn: ['completed', 'failed', 'timed_out', 'superseded'] } },
        data:  { status: 'failed', failedAt: new Date(), failReason: 'OPT_OUT' },
      })
    }
    return
  }

  if (upperText === 'START' || upperText === 'UNSTOP' || upperText === 'YES') {
    const user = await prisma.user.findFirst({ where: { phone: from, deletedAt: null } })
    if (user) {
      await prisma.user.update({ where: { id: user.id }, data: { smsOptedOut: false } })
    }
    return
  }

  // ── Idempotency — skip if this Twilio SID was already processed ────────────
  const duplicate = await prisma.message.findUnique({ where: { twilioSid: smsSid } })
  if (duplicate) return

  // ── Find the participant ───────────────────────────────────────────────────
  const user = await prisma.user.findFirst({
    where: { phone: from, deletedAt: null },
  })

  if (!user) {
    await prisma.inboundAuditLog.create({
      data: { fromPhone: from, body: text, reason: 'NO_CONVERSATION' },
    })
    return
  }

  // ── Find the open conversation ─────────────────────────────────────────────
  const conversation = await prisma.conversation.findFirst({
    where:   { userId: user.id, status: { notIn: ['completed', 'failed', 'timed_out', 'superseded'] } },
    orderBy: { startedAt: 'desc' },
  })

  if (!conversation) {
    await prisma.inboundAuditLog.create({
      data: { fromPhone: from, body: text, reason: 'NO_CONVERSATION' },
    })
    return
  }

  // ── Out-of-turn guard — only process if awaiting_reply ────────────────────
  // Atomic update: only succeeds if status is exactly 'awaiting_reply'
  const locked = await prisma.conversation.updateMany({
    where: { id: conversation.id, status: 'awaiting_reply' },
    data:  { status: 'processing', lastMessageAt: new Date() },
  })

  if (locked.count === 0) {
    await prisma.inboundAuditLog.create({
      data: {
        fromPhone:      from,
        body:           text,
        conversationId: conversation.id,
        reason:         conversation.status === 'processing' ? 'OUT_OF_TURN' : 'SESSION_CLOSED',
      },
    })
    return
  }

  // ── Save the inbound message ───────────────────────────────────────────────
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role:           'participant',
      body:           text,
      twilioSid:      smsSid,
    },
  })

  // ── Enqueue conversation processing ───────────────────────────────────────
  await conversationQueue.add(
    'process',
    { conversationId: conversation.id },
    { jobId: `conv:${conversation.id}:${smsSid}` },
  )
}

// ─── Status callback handler ──────────────────────────────────────────────────

async function handleStatusCallback(body: Record<string, string>) {
  const smsSid = body.SmsSid ?? body.MessageSid
  const status = body.MessageStatus

  // Only act on hard failures
  if (!['failed', 'undelivered'].includes(status)) return

  const message = await prisma.message.findUnique({
    where:  { twilioSid: smsSid },
    select: { conversationId: true },
  })

  if (!message) return

  await prisma.conversation.update({
    where: { id: message.conversationId },
    data:  {
      status:     'failed',
      failedAt:   new Date(),
      failReason: 'TWILIO_DELIVERY_FAILED',
    },
  })
}
