import { Worker } from 'bullmq'
import { redis } from '../redis.js'
import { prisma } from '../db.js'
import type { ISmsProvider } from '../services/sms/sms.provider.interface.js'
import type { IAiProvider } from '../services/ai/ai.provider.interface.js'
import { createSmsProvider } from '../services/sms/sms.factory.js'
import { createAiProvider } from '../services/ai/ai.factory.js'

export function startConversationWorker() {
  const smsProvider = createSmsProvider()
  const aiProvider  = createAiProvider()

  const worker = new Worker(
    'conversation',
    async (job) => {
      const { conversationId } = job.data as { conversationId: number }
      await processConversation(conversationId, smsProvider, aiProvider)
    },
    {
      connection:  redis,
      concurrency: 5,
    },
  )

  worker.on('failed', (job, err) => {
    console.error(
      `[conversation-worker] job ${job?.id} failed (conversation ${job?.data?.conversationId}): ${err.message}`,
    )
  })

  return worker
}

// ─── Core processing logic ────────────────────────────────────────────────────

async function processConversation(
  conversationId: number,
  smsProvider:    ISmsProvider,
  aiProvider:     IAiProvider,
) {
  const conversation = await prisma.conversation.findUnique({
    where:   { id: conversationId },
    include: {
      broadcast: {
        include: {
          schedule: {
            include: {
              scheduleQuestions: {
                include: { question: { select: { id: true, text: true } } },
                orderBy: { questionId: 'asc' },
              },
            },
          },
        },
      },
      user:     { select: { id: true, phone: true } },
      messages: { orderBy: { sentAt: 'asc' } },
    },
  })

  if (!conversation) return
  if (conversation.status !== 'processing') return
  if (!conversation.user.phone) return

  const questions = conversation.broadcast.schedule.scheduleQuestions.map(sq => sq.question)

  // Find the last AI message index to only process new participant messages
  const messages      = conversation.messages
  const lastAiIndex   = messages.map(m => m.role).lastIndexOf('ai')
  const newMessages   = lastAiIndex === -1 ? messages : messages.slice(lastAiIndex + 1)
  const participantMessages = newMessages.filter(m => m.role === 'participant')

  if (participantMessages.length === 0) {
    await resetToAwaiting(conversationId)
    return
  }

  // Concatenate all participant messages since last AI turn
  const combinedReply = participantMessages.map(m => m.body).join(' ')

  // Build full conversation history for AI context
  const history = messages.map(m => ({
    role: m.role as 'ai' | 'participant',
    body: m.body,
  }))

  // Extract answers
  let result
  try {
    result = await aiProvider.extractAnswers({
      questions: questions.map(q => q.text),
      messages:  history,
    })
  } catch (err) {
    console.error(`[conversation-worker] AI extraction failed for conversation ${conversationId}:`, err)
    await resetToAwaiting(conversationId)
    return
  }

  // Store confident answers (upsert in case of reprocessing)
  const confidentAnswers = result.answers.filter(a => a.confident && a.answer !== null)

  for (const ans of confidentAnswers) {
    const question = questions[ans.questionIndex]
    if (!question) continue

    await prisma.answer.upsert({
      where:  { conversationId_questionId: { conversationId, questionId: question.id } },
      create: { conversationId, questionId: question.id, answer: ans.answer! },
      update: { answer: ans.answer! },
    })
  }

  // All questions answered → complete the conversation
  if (result.followUp === null) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data:  { status: 'completed', completedAt: new Date() },
    })

    await checkBroadcastComplete(conversation.broadcast.id)
    return
  }

  // Some answers still missing → send follow-up and wait for next reply
  try {
    const twilioSid = await smsProvider.sendSms(conversation.user.phone, result.followUp)

    await prisma.message.create({
      data: {
        conversationId,
        role:      'ai',
        body:      result.followUp,
        twilioSid,
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data:  { status: 'awaiting_reply', lastMessageAt: new Date() },
    })
  } catch (err) {
    console.error(`[conversation-worker] failed to send follow-up for conversation ${conversationId}:`, err)
    await prisma.conversation.update({
      where: { id: conversationId },
      data:  {
        status:     'failed',
        failedAt:   new Date(),
        failReason: err instanceof Error ? err.message : 'FOLLOW_UP_SEND_FAILED',
      },
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resetToAwaiting(conversationId: number) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data:  { status: 'awaiting_reply' },
  })
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
  }
}
