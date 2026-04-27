import { DateTime } from 'luxon'
import { prisma } from '../db.js'
import { config } from '../config.js'
import type { ISmsProvider } from './sms/sms.provider.interface.js'
import type { IAiProvider } from './ai/ai.provider.interface.js'
import { assertMessageLength, SmsTooLongError } from './sms/sms.service.js'

const SMS_RETRY_LIMIT = 2

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runBroadcast(
  scheduleId:  number,
  smsProvider: ISmsProvider,
  aiProvider:  IAiProvider,
  triggeredBy?: number,
  force = false,
): Promise<void> {
  const schedule = await prisma.schedule.findUnique({
    where:  { id: scheduleId },
    include: {
      scheduleQuestions: {
        include: { question: { select: { id: true, text: true } } },
      },
      manager: { select: { id: true } },
    },
  })

  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`)
  if (!schedule.active) throw new Error(`Schedule ${scheduleId} is inactive`)

  const questions = schedule.scheduleQuestions.map(sq => sq.question)
  if (questions.length === 0) throw new Error(`Schedule ${scheduleId} has no questions`)

  // fireDate is "YYYY-MM-DD" in the schedule's timezone
  const fireDate = DateTime.now().setZone(schedule.timezone).toISODate()!

  // Idempotency — one broadcast per schedule per calendar day (skipped for manual sends)
  if (!force) {
    const existing = await prisma.broadcast.findUnique({
      where: { scheduleId_fireDate: { scheduleId, fireDate } },
    })
    if (existing) return
  }

  const broadcast = await prisma.broadcast.upsert({
    where:  { scheduleId_fireDate: { scheduleId, fireDate } },
    create: { scheduleId, fireDate, status: 'in_progress', triggeredBy: triggeredBy ?? null },
    update: { status: 'in_progress', triggeredBy: triggeredBy ?? null },
  })

  const participants = await getParticipants(schedule)

  for (const participant of participants) {
    await processParticipant({
      broadcast,
      participant,
      questions:   questions.map(q => q.text),
      questionIds: questions.map(q => q.id),
      smsProvider,
      aiProvider,
    })
  }

  // Mark broadcast completed when all conversations are in a terminal state
  const pending = await prisma.conversation.count({
    where: {
      broadcastId: broadcast.id,
      status:      { notIn: ['completed', 'failed', 'timed_out', 'superseded'] },
    },
  })

  if (pending === 0) {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data:  { status: 'completed' },
    })
  } else {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data:  { status: 'in_progress' },
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getParticipants(schedule: {
  id:            number
  managerId:     number
  recipientMode: string
}) {
  if (schedule.recipientMode === 'subset') {
    return prisma.user.findMany({
      where: {
        role:              { in: ['participant', 'viewer'] },
        active:             true,
        deletedAt:          null,
        scheduleRecipient: { some: { scheduleId: schedule.id } },
      },
      select: { id: true, phone: true, smsOptedOut: true },
    })
  }

  // 'all' — every participant/viewer in every group this manager oversees
  return prisma.user.findMany({
    where: {
      role:      { in: ['participant', 'viewer'] },
      active:    true,
      deletedAt: null,
      groupMembers: {
        some: {
          group: {
            deletedAt:    null,
            managerLinks: { some: { managerId: schedule.managerId } },
          },
        },
      },
    },
    select: { id: true, phone: true, smsOptedOut: true },
  })
}

async function processParticipant(params: {
  broadcast:   { id: number }
  participant: { id: number; phone: string | null; smsOptedOut: boolean }
  questions:   string[]
  questionIds: number[]
  smsProvider: ISmsProvider
  aiProvider:  IAiProvider
}) {
  const { broadcast, participant, questions, smsProvider, aiProvider } = params

  if (participant.smsOptedOut) return
  if (!participant.phone)      return

  // Supersede any open conversation for this participant
  await prisma.conversation.updateMany({
    where: {
      userId:    participant.id,
      status:    { notIn: ['completed', 'failed', 'timed_out', 'superseded'] },
    },
    data: { status: 'superseded', failReason: 'SUPERSEDED_BY_NEW_BROADCAST' },
  })

  // Generate the SMS message — retry up to SMS_RETRY_LIMIT times if too long
  let body: string | null = null
  let attempt = 0

  while (attempt <= SMS_RETRY_LIMIT) {
    const generated = await aiProvider.generateMessage({
      questions,
      maxLength:       config.sms.maxLength,
      previousAttempt: body ?? undefined,
    })

    const result = generated.length <= config.sms.maxLength ? generated : null

    if (result !== null) {
      body = result
      break
    }

    body = generated
    attempt++
  }

  // Create the conversation
  const conversation = await prisma.conversation.create({
    data: {
      broadcastId:   broadcast.id,
      userId:        participant.id,
      status:        'pending',
      startedAt:     new Date(),
      lastMessageAt: new Date(),
    },
  })

  // Still too long after retries — fail this conversation, continue the broadcast
  if (body === null || body.length > config.sms.maxLength) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { status: 'failed', failedAt: new Date(), failReason: 'SMS_TOO_LONG' },
    })
    return
  }

  // Send SMS
  try {
    const twilioSid = await smsProvider.sendSms(participant.phone, body)

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role:           'ai',
        body,
        twilioSid,
      },
    })

    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { status: 'awaiting_reply', lastMessageAt: new Date() },
    })
  } catch (err) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  {
        status:     'failed',
        failedAt:   new Date(),
        failReason: err instanceof Error ? err.message : 'SEND_FAILED',
      },
    })
  }
}
