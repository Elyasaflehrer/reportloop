import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

// ─── Validation schemas ───────────────────────────────────────────────────────

const createQuestionBody = z.object({
  text: z.string().min(1).max(500),
})

const updateQuestionBody = z.object({
  text: z.string().min(1).max(500),
})

const listQuery = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Estimate the SMS length for a list of question texts.
// Rough projection: questions joined by newlines inside a minimal wrapper.
function estimateBundleLength(questions: string[]): number {
  const body = questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
  return body.length
}

async function checkQuestionLength(questionIds: number[]): Promise<{ warning: boolean; tooLong: boolean }> {
  const questions = await prisma.question.findMany({
    where:  { id: { in: questionIds }, deletedAt: null },
    select: { text: true },
  })
  const texts  = questions.map(q => q.text)
  const length = estimateBundleLength(texts)
  const max    = config.sms.maxLength

  return {
    tooLong: length > max,
    warning: length > max * 0.8 && length <= max,
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function questionsRoutes(app: FastifyInstance) {

  // ─── GET /questions ────────────────────────────────────────────────────────

  app.get('/questions', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const query = listQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit } = query.data
    const skip = (page - 1) * limit

    // Managers see only their own questions; admins see all
    const where = {
      deletedAt: null,
      ...(req.user.role === 'manager' && { managerId: req.user.id }),
    }

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:        true,
          text:      true,
          managerId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { scheduleQuestions: true } },
        },
      }),
      prisma.question.count({ where }),
    ])

    return reply.send({
      data: questions,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /questions/:id ────────────────────────────────────────────────────

  app.get('/questions/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const questionId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(questionId)) return reply.status(400).send({ error: 'Invalid question id' })

    const question = await prisma.question.findFirst({
      where: {
        id:        questionId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
      select: {
        id:        true,
        text:      true,
        managerId: true,
        createdAt: true,
        updatedAt: true,
        scheduleQuestions: {
          select: {
            schedule: { select: { id: true, label: true, dayOfWeek: true, timeOfDay: true } },
          },
        },
      },
    })

    if (!question) return reply.status(404).send({ error: 'Question not found' })

    return reply.send({
      ...question,
      schedules:         question.scheduleQuestions.map(sq => sq.schedule),
      scheduleQuestions: undefined,
    })
  })

  // ─── POST /questions ───────────────────────────────────────────────────────

  app.post('/questions', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const body = createQuestionBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const question = await prisma.question.create({
      data: { text: body.data.text, managerId: req.user.id },
      select: { id: true, text: true, managerId: true, createdAt: true },
    })

    return reply.status(201).send(question)
  })

  // ─── PATCH /questions/:id ──────────────────────────────────────────────────

  app.patch('/questions/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const questionId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(questionId)) return reply.status(400).send({ error: 'Invalid question id' })

    const body = updateQuestionBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.question.findFirst({
      where: {
        id:        questionId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
    })
    if (!existing) return reply.status(404).send({ error: 'Question not found' })

    // Check SMS length across all schedules that use this question
    const siblings = await prisma.scheduleQuestion.findMany({
      where: { questionId },
      select: {
        schedule: {
          select: {
            scheduleQuestions: { select: { questionId: true } },
          },
        },
      },
    })

    // Collect all unique question IDs from those schedules, replacing this question's text
    const affectedQuestionIds = new Set<number>()
    for (const sq of siblings) {
      for (const q of sq.schedule.scheduleQuestions) {
        affectedQuestionIds.add(q.questionId)
      }
    }
    affectedQuestionIds.delete(questionId) // replace with the updated text below

    const siblingTexts = affectedQuestionIds.size > 0
      ? (await prisma.question.findMany({
          where:  { id: { in: [...affectedQuestionIds] }, deletedAt: null },
          select: { text: true },
        })).map(q => q.text)
      : []

    const allTexts = [...siblingTexts, body.data.text]
    const length   = estimateBundleLength(allTexts)
    const max      = config.sms.maxLength

    if (length > max) {
      return reply.status(400).send({
        error: `Updating this question would make the SMS bundle too long (${length} chars, max ${max})`,
      })
    }

    const question = await prisma.question.update({
      where:  { id: questionId },
      data:   { text: body.data.text },
      select: { id: true, text: true, managerId: true, updatedAt: true },
    })

    const warning = length > max * 0.8

    return reply.send({ ...question, ...(warning && { warning: 'SMS bundle is over 80% of the character limit' }) })
  })

  // ─── DELETE /questions/:id ─────────────────────────────────────────────────

  app.delete('/questions/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const questionId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(questionId)) return reply.status(400).send({ error: 'Invalid question id' })

    const existing = await prisma.question.findFirst({
      where: {
        id:        questionId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
    })
    if (!existing) return reply.status(404).send({ error: 'Question not found' })

    await prisma.question.update({
      where: { id: questionId },
      data:  { deletedAt: new Date() },
    })

    return reply.status(204).send()
  })
}
