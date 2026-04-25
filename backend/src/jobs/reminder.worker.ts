import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from '../db.js'
import { config } from '../config.js'
import type { ISmsProvider } from '../services/sms/sms.provider.interface.js'

export function startReminderWorker(smsProvider: ISmsProvider) {
  const task = cron.schedule(config.node_env === 'test' ? null as any : '*/15 * * * *', async () => {
    try {
      await runReminderLadder(smsProvider)
      await runStuckRecovery()
    } catch (err) {
      console.error('[reminder-worker] error:', err)
    }
  })

  console.info('[reminder-worker] started — running every 15 minutes')
  return task
}

// ─── Reminder ladder ──────────────────────────────────────────────────────────
// Nudges participants who haven't replied. Times out conversations that
// have hit the max reminder count.

async function runReminderLadder(smsProvider: ISmsProvider) {
  const cutoff = DateTime.now()
    .minus({ minutes: config.conversation.reminderIntervalMinutes })
    .toJSDate()

  const stale = await prisma.conversation.findMany({
    where: {
      status:        'awaiting_reply',
      lastMessageAt: { lte: cutoff },
    },
    include: {
      user:      { select: { phone: true, smsOptedOut: true } },
      broadcast: { select: { id: true } },
      messages:  {
        where:   { role: 'ai' },
        orderBy: { sentAt: 'asc' },
        take:    1,
        select:  { body: true },
      },
    },
  })

  for (const conv of stale) {
    if (!conv.user.phone || conv.user.smsOptedOut) {
      await timeoutConversation(conv.id, 'NO_PHONE_OR_OPTED_OUT')
      continue
    }

    if (conv.remindersSent >= config.conversation.reminderCount) {
      await timeoutConversation(conv.id, 'NO_RESPONSE')
      await checkBroadcastComplete(conv.broadcast.id)
      continue
    }

    // Send nudge — resend the original AI message
    const originalBody = conv.messages[0]?.body
    if (!originalBody) {
      await timeoutConversation(conv.id, 'NO_ORIGINAL_MESSAGE')
      continue
    }

    try {
      await smsProvider.sendSms(conv.user.phone, originalBody)

      await prisma.conversation.update({
        where: { id: conv.id },
        data:  {
          remindersSent: { increment: 1 },
          lastMessageAt: new Date(),
        },
      })

      console.info(`[reminder-worker] sent reminder ${conv.remindersSent + 1} for conversation ${conv.id}`)
    } catch (err) {
      console.error(`[reminder-worker] failed to send reminder for conversation ${conv.id}:`, err)
    }
  }
}

// ─── Stuck recovery ───────────────────────────────────────────────────────────
// Resets conversations stuck in 'processing' back to 'awaiting_reply'.
// Happens when a conversation worker crashes mid-processing.

async function runStuckRecovery() {
  const cutoff = DateTime.now()
    .minus({ minutes: config.conversation.stuckTimeoutMinutes })
    .toJSDate()

  const stuck = await prisma.conversation.findMany({
    where: {
      status:        'processing',
      lastMessageAt: { lte: cutoff },
    },
    select: { id: true },
  })

  if (stuck.length === 0) return

  await prisma.conversation.updateMany({
    where: { id: { in: stuck.map(c => c.id) } },
    data:  { status: 'awaiting_reply' },
  })

  console.warn(
    `[reminder-worker] recovered ${stuck.length} stuck conversation(s) from 'processing' → 'awaiting_reply'`,
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function timeoutConversation(conversationId: number, reason: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data:  { status: 'timed_out', failedAt: new Date(), failReason: reason },
  })
  console.info(`[reminder-worker] conversation ${conversationId} timed out: ${reason}`)
}

async function checkBroadcastComplete(broadcastId: number) {
  const pending = await prisma.conversation.count({
    where: {
      broadcastId,
      status: { notIn: ['completed', 'failed', 'timed_out', 'superseded'] },
    },
  })

  if (pending === 0) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data:  { status: 'completed' },
    })
    console.info(`[reminder-worker] broadcast ${broadcastId} marked completed`)
  }
}
