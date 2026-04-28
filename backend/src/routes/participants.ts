import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type UserRole } from '@prisma/client'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

// ─── Validation schemas ───────────────────────────────────────────────────────

const e164 = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format (e.g. +15551234567)')

const createParticipantBody = z.object({
  name:     z.string().min(1).max(100),
  phone:    e164,
  email:    z.string().email().optional(),
  initials: z.string().max(4).optional(),
  title:    z.string().max(100).optional(),
})

const updateParticipantBody = z.object({
  name:     z.string().min(1).max(100).optional(),
  phone:    e164.optional(),
  email:    z.string().email().optional(),
  initials: z.string().max(4).optional(),
  title:    z.string().max(100).optional(),
  active:   z.boolean().optional(),
})

const listQuery = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(500).default(50),
  active:  z.enum(['true', 'false']).optional(),
  groupId: z.coerce.number().int().optional(),
  search:  z.string().optional(),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function participantsRoutes(app: FastifyInstance) {

  // ─── GET /participants ─────────────────────────────────────────────────────

  app.get('/participants', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const query = listQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit, active, groupId, search } = query.data
    const skip = (page - 1) * limit

    // Managers only see participants in their groups
    const scopeFilter = req.user.role === 'manager'
      ? {
          groupMembers: {
            some: {
              group: { managerLinks: { some: { managerId: req.user.id } } },
            },
          },
        }
      : {}

    const where = {
      role:      { in: ['participant', 'viewer'] as UserRole[] },
      deletedAt: null,
      ...scopeFilter,
      ...(active !== undefined && { active: active === 'true' }),
      ...(groupId && { groupMembers: { some: { groupId } } }),
      ...(search && {
        OR: [
          { name:  { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      }),
    }

    const [participants, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { name: 'asc' },
        select: {
          id:          true,
          name:        true,
          email:       true,
          phone:       true,
          initials:    true,
          title:       true,
          active:      true,
          smsOptedOut: true,
          createdAt:   true,
          updatedAt:   true,
        },
      }),
      prisma.user.count({ where }),
    ])

    return reply.send({
      data: participants,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /participants/:id ─────────────────────────────────────────────────

  app.get('/participants/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const participantId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(participantId)) return reply.status(400).send({ error: 'Invalid participant id' })

    const scopeFilter = req.user.role === 'manager'
      ? {
          groupMembers: {
            some: {
              group: { managerLinks: { some: { managerId: req.user.id } } },
            },
          },
        }
      : {}

    const participant = await prisma.user.findFirst({
      where: { id: participantId, role: { in: ['participant', 'viewer'] }, deletedAt: null, ...scopeFilter },
      select: {
        id:          true,
        name:        true,
        email:       true,
        phone:       true,
        initials:    true,
        title:       true,
        active:      true,
        smsOptedOut: true,
        createdAt:   true,
        updatedAt:   true,
        groupMembers: {
          select: {
            group: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!participant) return reply.status(404).send({ error: 'Participant not found' })

    return reply.send({
      ...participant,
      groups:       participant.groupMembers.map(m => m.group),
      groupMembers: undefined,
    })
  })

  // ─── POST /participants ────────────────────────────────────────────────────

  app.post('/participants', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const body = createParticipantBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    try {
      const participant = await prisma.user.create({
        data: { ...body.data, role: 'participant' },
        select: {
          id:        true,
          name:      true,
          email:     true,
          phone:     true,
          initials:  true,
          title:     true,
          active:    true,
          createdAt: true,
        },
      })
      return reply.status(201).send(participant)
    } catch (err: any) {
      if (err.code === 'P2002') {
        const field = err.meta?.target?.[0] ?? 'field'
        return reply.status(409).send({ error: `A participant with this ${field} already exists` })
      }
      throw err
    }
  })

  // ─── PATCH /participants/:id ───────────────────────────────────────────────

  app.patch('/participants/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const participantId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(participantId)) return reply.status(400).send({ error: 'Invalid participant id' })

    // Block smsOptedOut — only Twilio webhooks can change it
    if ((req.body as any)?.smsOptedOut !== undefined) {
      return reply.status(400).send({ error: 'smsOptedOut can only be changed by SMS opt-out webhooks' })
    }

    const body = updateParticipantBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const scopeFilter = req.user.role === 'manager'
      ? {
          groupMembers: {
            some: {
              group: { managerLinks: { some: { managerId: req.user.id } } },
            },
          },
        }
      : {}

    const existing = await prisma.user.findFirst({
      where: { id: participantId, role: { in: ['participant', 'viewer'] }, deletedAt: null, ...scopeFilter },
    })
    if (!existing) return reply.status(404).send({ error: 'Participant not found' })

    try {
      const participant = await prisma.user.update({
        where:  { id: participantId },
        data:   body.data,
        select: {
          id:        true,
          name:      true,
          email:     true,
          phone:     true,
          initials:  true,
          title:     true,
          active:    true,
          updatedAt: true,
        },
      })
      return reply.send(participant)
    } catch (err: any) {
      if (err.code === 'P2002') {
        const field = err.meta?.target?.[0] ?? 'field'
        return reply.status(409).send({ error: `A participant with this ${field} already exists` })
      }
      throw err
    }
  })

  // ─── DELETE /participants/:id ──────────────────────────────────────────────

  app.delete('/participants/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const participantId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(participantId)) return reply.status(400).send({ error: 'Invalid participant id' })

    const scopeFilter = req.user.role === 'manager'
      ? {
          groupMembers: {
            some: {
              group: { managerLinks: { some: { managerId: req.user.id } } },
            },
          },
        }
      : {}

    const existing = await prisma.user.findFirst({
      where: { id: participantId, role: { in: ['participant', 'viewer'] }, deletedAt: null, ...scopeFilter },
    })
    if (!existing) return reply.status(404).send({ error: 'Participant not found' })

    await prisma.user.update({
      where: { id: participantId },
      data:  { active: false, deletedAt: new Date() },
    })

    return reply.status(204).send()
  })
}
