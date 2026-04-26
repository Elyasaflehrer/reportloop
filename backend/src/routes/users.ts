import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'
import { supabaseAdmin } from '../supabase.js'
import { config } from '../config.js'

// ─── Validation schemas ───────────────────────────────────────────────────────

const roleValues = ['admin', 'manager', 'viewer', 'participant'] as const

const createUserBody = z.object({
  name:     z.string().min(1).max(100),
  email:    z.string().email().optional(),
  phone:    z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format').optional(),
  role:     z.enum(roleValues),
  title:    z.string().max(100).optional(),
  initials: z.string().max(4).optional(),
})

const updateUserBody = z.object({
  name:     z.string().min(1).max(100).optional(),
  email:    z.string().email().optional(),
  phone:    z.string().regex(/^\+[1-9]\d{1,14}$/, 'Phone must be E.164 format').optional(),
  role:     z.enum(roleValues).optional(),
  title:    z.string().max(100).optional(),
  initials: z.string().max(4).optional(),
  active:   z.boolean().optional(),
})

const listUsersQuery = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(500).default(50),
  role:    z.enum(roleValues).optional(),
  active:  z.enum(['true', 'false']).optional(),
  groupId: z.coerce.number().int().optional(),
  search:  z.string().optional(),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function usersRoutes(app: FastifyInstance) {

  // ─── GET /users ────────────────────────────────────────────────────────────

  app.get('/users', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const query = listUsersQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit, role, active, groupId, search } = query.data
    const skip = (page - 1) * limit

    const where = {
      deletedAt: null,
      ...(role   && { role }),
      ...(active !== undefined && { active: active === 'true' }),
      ...(search && {
        OR: [
          { name:  { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      }),
      ...(groupId && {
        groupMembers: { some: { groupId } },
      }),
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { name: 'asc' },
        select: {
          id:         true,
          name:       true,
          email:      true,
          phone:      true,
          initials:   true,
          title:      true,
          role:       true,
          active:     true,
          smsOptedOut:true,
          createdAt:  true,
          updatedAt:  true,
        },
      }),
      prisma.user.count({ where }),
    ])

    return reply.send({
      data: users,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /users/:id ────────────────────────────────────────────────────────

  app.get('/users/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = parseInt(id, 10)
    if (isNaN(userId)) return reply.status(400).send({ error: 'Invalid user id' })

    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id:          true,
        name:        true,
        email:       true,
        phone:       true,
        initials:    true,
        title:       true,
        role:        true,
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

    if (!user) return reply.status(404).send({ error: 'User not found' })

    return reply.send({
      ...user,
      groups: user.groupMembers.map(m => m.group),
      groupMembers: undefined,
    })
  })

  // ─── POST /users ───────────────────────────────────────────────────────────

  app.post('/users', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = createUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const { name, email, phone, role, title, initials } = body.data

    // Participants must have a phone number
    if (role === 'participant' && !phone) {
      return reply.status(400).send({ error: 'Participants must have a phone number' })
    }

    // Non-participants must have an email
    if (role !== 'participant' && !email) {
      return reply.status(400).send({ error: 'Admins, managers, and viewers must have an email' })
    }

    try {
      const user = await prisma.user.create({
        data: { name, email, phone, role, title, initials },
        select: {
          id:        true,
          name:      true,
          email:     true,
          phone:     true,
          initials:  true,
          title:     true,
          role:      true,
          active:    true,
          createdAt: true,
        },
      })

      // Send invite email so the user can set their own password.
      // Participants have no platform account — skip.
      if (email && role !== 'participant') {
        const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: config.app.frontendOrigin,
        })
        if (inviteError) {
          req.log.warn({ err: inviteError, userId: user.id }, '[users] invite email failed — user created but not invited')
        }
      }

      return reply.status(201).send(user)
    } catch (err: any) {
      if (err.code === 'P2002') {
        const field = err.meta?.target?.[0] ?? 'field'
        return reply.status(409).send({ error: `A user with this ${field} already exists` })
      }
      throw err
    }
  })

  // ─── POST /users/:id/resend-invite ────────────────────────────────────────

  app.post('/users/:id/resend-invite', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = parseInt(id, 10)
    if (isNaN(userId)) return reply.status(400).send({ error: 'Invalid user id' })

    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!user)        return reply.status(404).send({ error: 'User not found' })
    if (!user.email)  return reply.status(400).send({ error: 'User has no email address' })
    if (user.role === 'participant') return reply.status(400).send({ error: 'Participants do not have platform accounts' })

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(user.email, {
      redirectTo: config.app.frontendOrigin,
    })

    if (inviteError) {
      req.log.warn({ err: inviteError, userId }, '[users] resend invite failed')
      return reply.status(422).send({ error: inviteError.message })
    }

    return reply.status(204).send()
  })

  // ─── PATCH /users/:id ──────────────────────────────────────────────────────

  app.patch('/users/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = parseInt(id, 10)
    if (isNaN(userId)) return reply.status(400).send({ error: 'Invalid user id' })

    const body = updateUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ error: 'User not found' })

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data:  body.data,
        select: {
          id:        true,
          name:      true,
          email:     true,
          phone:     true,
          initials:  true,
          title:     true,
          role:      true,
          active:    true,
          updatedAt: true,
        },
      })
      return reply.send(user)
    } catch (err: any) {
      if (err.code === 'P2002') {
        const field = err.meta?.target?.[0] ?? 'field'
        return reply.status(409).send({ error: `A user with this ${field} already exists` })
      }
      throw err
    }
  })

  // ─── DELETE /users/:id ─────────────────────────────────────────────────────

  app.delete('/users/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = parseInt(id, 10)
    if (isNaN(userId)) return reply.status(400).send({ error: 'Invalid user id' })

    // Prevent self-deletion
    if (userId === req.user.id) {
      return reply.status(400).send({ error: 'You cannot delete your own account' })
    }

    const existing = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ error: 'User not found' })

    await prisma.user.update({
      where: { id: userId },
      data:  { active: false, deletedAt: new Date() },
    })

    return reply.status(204).send()
  })
}
