import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

// ─── Validation schemas ───────────────────────────────────────────────────────

const dayOfWeekValues = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const recipientModeValues = ['all', 'subset'] as const

const timeOfDayRegex = /^([01]\d|2[0-3]):[0-5]\d$/  // HH:MM 24h

const validTimezones = new Set(Intl.supportedValuesOf('timeZone'))

const timezoneSchema = z.string().refine(
  tz => validTimezones.has(tz),
  tz => ({ message: `"${tz}" is not a valid IANA timezone` })
)

const createScheduleBody = z.object({
  label:         z.string().max(100).optional(),
  dayOfWeek:     z.enum(dayOfWeekValues),
  timeOfDay:     z.string().regex(timeOfDayRegex, 'timeOfDay must be HH:MM in 24h format'),
  timezone:      timezoneSchema,
  recipientMode: z.enum(recipientModeValues),
  active:        z.boolean().default(true),
})

const updateScheduleBody = z.object({
  label:         z.string().max(100).optional(),
  dayOfWeek:     z.enum(dayOfWeekValues).optional(),
  timeOfDay:     z.string().regex(timeOfDayRegex, 'timeOfDay must be HH:MM in 24h format').optional(),
  timezone:      timezoneSchema.optional(),
  recipientMode: z.enum(recipientModeValues).optional(),
  active:        z.boolean().optional(),
})

const listQuery = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  active: z.enum(['true', 'false']).optional(),
})

const questionBody = z.object({
  questionId: z.number().int().positive(),
})

const recipientBody = z.object({
  userId: z.number().int().positive(),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function schedulesRoutes(app: FastifyInstance) {

  // ─── GET /schedules ────────────────────────────────────────────────────────

  app.get('/schedules', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const query = listQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit, active } = query.data
    const skip = (page - 1) * limit

    const where = {
      deletedAt: null,
      ...(req.user.role === 'manager' && { managerId: req.user.id }),
      ...(active !== undefined && { active: active === 'true' }),
    }

    const [schedules, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:            true,
          label:         true,
          dayOfWeek:     true,
          timeOfDay:     true,
          timezone:      true,
          recipientMode: true,
          active:        true,
          managerId:     true,
          createdAt:     true,
          updatedAt:     true,
          _count: {
            select: { scheduleQuestions: true, scheduleRecipients: true },
          },
        },
      }),
      prisma.schedule.count({ where }),
    ])

    return reply.send({
      data: schedules,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /schedules/:id ────────────────────────────────────────────────────

  app.get('/schedules/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const scheduleId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(scheduleId)) return reply.status(400).send({ error: 'Invalid schedule id' })

    const schedule = await prisma.schedule.findFirst({
      where: {
        id:        scheduleId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
      select: {
        id:            true,
        label:         true,
        dayOfWeek:     true,
        timeOfDay:     true,
        timezone:      true,
        recipientMode: true,
        active:        true,
        managerId:     true,
        createdAt:     true,
        updatedAt:     true,
        scheduleQuestions: {
          select: {
            question: { select: { id: true, text: true } },
          },
        },
        scheduleRecipients: {
          select: {
            user: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
    })

    if (!schedule) return reply.status(404).send({ error: 'Schedule not found' })

    return reply.send({
      ...schedule,
      questions:          schedule.scheduleQuestions.map(sq => sq.question),
      recipients:         schedule.scheduleRecipients.map(sr => sr.user),
      scheduleQuestions:  undefined,
      scheduleRecipients: undefined,
    })
  })

  // ─── POST /schedules ───────────────────────────────────────────────────────

  app.post('/schedules', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const body = createScheduleBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const schedule = await prisma.schedule.create({
      data: { ...body.data, managerId: req.user.id },
      select: {
        id:            true,
        label:         true,
        dayOfWeek:     true,
        timeOfDay:     true,
        timezone:      true,
        recipientMode: true,
        active:        true,
        createdAt:     true,
      },
    })

    return reply.status(201).send(schedule)
  })

  // ─── PATCH /schedules/:id ──────────────────────────────────────────────────

  app.patch('/schedules/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const scheduleId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(scheduleId)) return reply.status(400).send({ error: 'Invalid schedule id' })

    const body = updateScheduleBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.schedule.findFirst({
      where: {
        id:        scheduleId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
    })
    if (!existing) return reply.status(404).send({ error: 'Schedule not found' })

    const schedule = await prisma.schedule.update({
      where:  { id: scheduleId },
      data:   body.data,
      select: {
        id:            true,
        label:         true,
        dayOfWeek:     true,
        timeOfDay:     true,
        timezone:      true,
        recipientMode: true,
        active:        true,
        updatedAt:     true,
      },
    })

    return reply.send(schedule)
  })

  // ─── DELETE /schedules/:id ─────────────────────────────────────────────────

  app.delete('/schedules/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const scheduleId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(scheduleId)) return reply.status(400).send({ error: 'Invalid schedule id' })

    const existing = await prisma.schedule.findFirst({
      where: {
        id:        scheduleId,
        deletedAt: null,
        ...(req.user.role === 'manager' && { managerId: req.user.id }),
      },
    })
    if (!existing) return reply.status(404).send({ error: 'Schedule not found' })

    await prisma.schedule.update({
      where: { id: scheduleId },
      data:  { deletedAt: new Date() },
    })

    return reply.status(204).send()
  })

  // ─── POST /schedules/:id/questions ─────────────────────────────────────────

  app.post('/schedules/:id/questions', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const scheduleId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(scheduleId)) return reply.status(400).send({ error: 'Invalid schedule id' })

    const body = questionBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const [schedule, question] = await Promise.all([
      prisma.schedule.findFirst({
        where: {
          id:        scheduleId,
          deletedAt: null,
          ...(req.user.role === 'manager' && { managerId: req.user.id }),
        },
        select: {
          id:                true,
          scheduleQuestions: { select: { questionId: true } },
        },
      }),
      prisma.question.findFirst({
        where: {
          id:        body.data.questionId,
          deletedAt: null,
          ...(req.user.role === 'manager' && { managerId: req.user.id }),
        },
        select: { id: true, text: true },
      }),
    ])

    if (!schedule)  return reply.status(404).send({ error: 'Schedule not found' })
    if (!question)  return reply.status(404).send({ error: 'Question not found' })

    // Check SMS length with the new question added
    const existingIds  = schedule.scheduleQuestions.map(sq => sq.questionId)
    const allIds       = [...new Set([...existingIds, question.id])]
    const allQuestions = await prisma.question.findMany({
      where:  { id: { in: allIds }, deletedAt: null },
      select: { text: true },
    })
    const totalLength = allQuestions.reduce((acc, q) => acc + q.text.length + 4, 0) // +4 for "N. "
    const max         = 459 // config.sms.maxLength

    if (totalLength > max) {
      return reply.status(400).send({
        error: `Adding this question would make the SMS bundle too long (estimated ${totalLength} chars, max ${max})`,
      })
    }

    try {
      await prisma.scheduleQuestion.create({ data: { scheduleId, questionId: body.data.questionId } })
    } catch (err: any) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'Question is already attached to this schedule' })
      throw err
    }

    const warning = totalLength > max * 0.8

    return reply.status(201).send({ ...(warning && { warning: 'SMS bundle is over 80% of the character limit' }) })
  })

  // ─── DELETE /schedules/:id/questions/:questionId ───────────────────────────

  app.delete('/schedules/:id/questions/:questionId', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const { id, questionId } = req.params as { id: string; questionId: string }
    const scheduleId  = parseInt(id, 10)
    const qId         = parseInt(questionId, 10)
    if (isNaN(scheduleId) || isNaN(qId)) return reply.status(400).send({ error: 'Invalid id' })

    const link = await prisma.scheduleQuestion.findUnique({
      where: { scheduleId_questionId: { scheduleId, questionId: qId } },
    })
    if (!link) return reply.status(404).send({ error: 'Question is not attached to this schedule' })

    await prisma.scheduleQuestion.delete({
      where: { scheduleId_questionId: { scheduleId, questionId: qId } },
    })

    return reply.status(204).send()
  })

  // ─── POST /schedules/:id/recipients ────────────────────────────────────────

  app.post('/schedules/:id/recipients', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const scheduleId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(scheduleId)) return reply.status(400).send({ error: 'Invalid schedule id' })

    const body = recipientBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const [schedule, participant] = await Promise.all([
      prisma.schedule.findFirst({
        where: {
          id:        scheduleId,
          deletedAt: null,
          ...(req.user.role === 'manager' && { managerId: req.user.id }),
        },
      }),
      prisma.user.findFirst({
        where: { id: body.data.userId, role: 'participant', deletedAt: null },
      }),
    ])

    if (!schedule)    return reply.status(404).send({ error: 'Schedule not found' })
    if (!participant) return reply.status(404).send({ error: 'Participant not found' })

    try {
      await prisma.scheduleRecipient.create({ data: { scheduleId, userId: body.data.userId } })
    } catch (err: any) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'Participant is already a recipient of this schedule' })
      throw err
    }

    return reply.status(204).send()
  })

  // ─── DELETE /schedules/:id/recipients/:userId ──────────────────────────────

  app.delete('/schedules/:id/recipients/:userId', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    const scheduleId     = parseInt(id, 10)
    const recipientId    = parseInt(userId, 10)
    if (isNaN(scheduleId) || isNaN(recipientId)) return reply.status(400).send({ error: 'Invalid id' })

    const link = await prisma.scheduleRecipient.findUnique({
      where: { scheduleId_userId: { scheduleId, userId: recipientId } },
    })
    if (!link) return reply.status(404).send({ error: 'Participant is not a recipient of this schedule' })

    await prisma.scheduleRecipient.delete({
      where: { scheduleId_userId: { scheduleId, userId: recipientId } },
    })

    return reply.status(204).send()
  })
}
