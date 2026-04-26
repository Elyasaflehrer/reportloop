import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

// ─── Validation schemas ───────────────────────────────────────────────────────

const createGroupBody = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

const updateGroupBody = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})

const memberBody = z.object({
  userId: z.number().int().positive(),
})

const managerBody = z.object({
  managerId: z.number().int().positive(),
})

const listGroupsQuery = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().optional(),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function groupsRoutes(app: FastifyInstance) {

  // ─── GET /groups ───────────────────────────────────────────────────────────

  app.get('/groups', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const query = listGroupsQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit, search } = query.data
    const skip = (page - 1) * limit

    // Managers only see their own groups
    const managerFilter = req.user.role === 'manager'
      ? { managerLinks: { some: { managerId: req.user.id } } }
      : {}

    const where = {
      deletedAt: null,
      ...managerFilter,
      ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    }

    const [groups, total] = await Promise.all([
      prisma.group.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { name: 'asc' },
        select: {
          id:          true,
          name:        true,
          description: true,
          createdAt:   true,
          updatedAt:   true,
          members:     { select: { userId: true } },
          _count: {
            select: { members: true, managerLinks: true },
          },
        },
      }),
      prisma.group.count({ where }),
    ])

    return reply.send({
      data: groups.map(g => ({
        ...g,
        memberIds: g.members.map((m: { userId: number }) => m.userId),
        members:   undefined,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /groups/:id ───────────────────────────────────────────────────────

  app.get('/groups/:id', { preHandler: [authenticate, requireRole('admin', 'manager')] }, async (req, reply) => {
    const groupId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(groupId)) return reply.status(400).send({ error: 'Invalid group id' })

    const group = await prisma.group.findFirst({
      where: {
        id:        groupId,
        deletedAt: null,
        ...(req.user.role === 'manager' && {
          managerLinks: { some: { managerId: req.user.id } },
        }),
      },
      select: {
        id:          true,
        name:        true,
        description: true,
        createdAt:   true,
        updatedAt:   true,
        members: {
          select: {
            user: {
              select: { id: true, name: true, email: true, phone: true, role: true, active: true },
            },
          },
        },
        managerLinks: {
          select: {
            manager: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })

    if (!group) return reply.status(404).send({ error: 'Group not found' })

    return reply.send({
      ...group,
      members:      group.members.map(m => m.user),
      managers:     group.managerLinks.map(l => l.manager),
      managerLinks: undefined,
    })
  })

  // ─── POST /groups ──────────────────────────────────────────────────────────

  app.post('/groups', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const body = createGroupBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const group = await prisma.group.create({
      data:   body.data,
      select: { id: true, name: true, description: true, createdAt: true },
    })

    return reply.status(201).send(group)
  })

  // ─── PATCH /groups/:id ─────────────────────────────────────────────────────

  app.patch('/groups/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const groupId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(groupId)) return reply.status(400).send({ error: 'Invalid group id' })

    const body = updateGroupBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ error: 'Group not found' })

    const group = await prisma.group.update({
      where:  { id: groupId },
      data:   body.data,
      select: { id: true, name: true, description: true, updatedAt: true },
    })

    return reply.send(group)
  })

  // ─── DELETE /groups/:id ────────────────────────────────────────────────────

  app.delete('/groups/:id', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const groupId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(groupId)) return reply.status(400).send({ error: 'Invalid group id' })

    const existing = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ error: 'Group not found' })

    // Soft delete — GroupMember and ManagerGroup rows are hard-deleted via cascade
    await prisma.group.update({
      where: { id: groupId },
      data:  { deletedAt: new Date() },
    })

    return reply.status(204).send()
  })

  // ─── POST /groups/:id/members ──────────────────────────────────────────────

  app.post('/groups/:id/members', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const groupId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(groupId)) return reply.status(400).send({ error: 'Invalid group id' })

    const body = memberBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const [group, user] = await Promise.all([
      prisma.group.findFirst({ where: { id: groupId, deletedAt: null } }),
      prisma.user.findFirst({ where: { id: body.data.userId, deletedAt: null } }),
    ])

    if (!group) return reply.status(404).send({ error: 'Group not found' })
    if (!user)  return reply.status(404).send({ error: 'User not found' })

    try {
      await prisma.groupMember.create({ data: { groupId, userId: body.data.userId } })
    } catch (err: any) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'User is already a member of this group' })
      throw err
    }

    return reply.status(204).send()
  })

  // ─── DELETE /groups/:id/members/:userId ────────────────────────────────────

  app.delete('/groups/:id/members/:userId', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    const groupId       = parseInt(id, 10)
    const memberUserId  = parseInt(userId, 10)
    if (isNaN(groupId) || isNaN(memberUserId)) return reply.status(400).send({ error: 'Invalid id' })

    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    })
    if (!member) return reply.status(404).send({ error: 'Member not found in this group' })

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    })

    return reply.status(204).send()
  })

  // ─── POST /groups/:id/managers ─────────────────────────────────────────────

  app.post('/groups/:id/managers', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const groupId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(groupId)) return reply.status(400).send({ error: 'Invalid group id' })

    const body = managerBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const [group, manager] = await Promise.all([
      prisma.group.findFirst({ where: { id: groupId, deletedAt: null } }),
      prisma.user.findFirst({ where: { id: body.data.managerId, deletedAt: null, role: 'manager' } }),
    ])

    if (!group)   return reply.status(404).send({ error: 'Group not found' })
    if (!manager) return reply.status(404).send({ error: 'Manager not found' })

    try {
      await prisma.managerGroup.create({ data: { managerId: body.data.managerId, groupId } })
    } catch (err: any) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'Manager is already linked to this group' })
      throw err
    }

    return reply.status(204).send()
  })

  // ─── DELETE /groups/:id/managers/:managerId ────────────────────────────────

  app.delete('/groups/:id/managers/:managerId', { preHandler: [authenticate, requireRole('admin')] }, async (req, reply) => {
    const { id, managerId } = req.params as { id: string; managerId: string }
    const groupId       = parseInt(id, 10)
    const managerUserId = parseInt(managerId, 10)
    if (isNaN(groupId) || isNaN(managerUserId)) return reply.status(400).send({ error: 'Invalid id' })

    const link = await prisma.managerGroup.findUnique({
      where: { managerId_groupId: { managerId: managerUserId, groupId } },
    })
    if (!link) return reply.status(404).send({ error: 'Manager is not linked to this group' })

    await prisma.managerGroup.delete({
      where: { managerId_groupId: { managerId: managerUserId, groupId } },
    })

    return reply.status(204).send()
  })

  // ─── GET /manager-groups ──────────────────────────────────────────────────

  app.get('/manager-groups', { preHandler: [authenticate, requireRole('admin')] }, async (_req, reply) => {
    const links = await prisma.managerGroup.findMany({
      select: { managerId: true, groupId: true },
    })
    return reply.send({ data: links })
  })

  // ─── GET /admin/setup-status ───────────────────────────────────────────────

  app.get('/admin/setup-status', { preHandler: [authenticate, requireRole('admin')] }, async (_req, reply) => {
    const [
      totalGroups,
      totalManagerLinks,
      totalMembers,
      managersWithNoGroups,
      groupsWithNoManager,
      groupsWithNoMembers,
    ] = await Promise.all([
      prisma.group.count({ where: { deletedAt: null } }),
      prisma.managerGroup.count(),
      prisma.groupMember.count(),
      // Managers with role=manager but no manager_groups rows
      prisma.user.count({
        where: {
          role:         'manager',
          deletedAt:    null,
          active:       true,
          managerGroups: { none: {} },
        },
      }),
      // Groups with no manager linked
      prisma.group.count({
        where: {
          deletedAt:    null,
          managerLinks: { none: {} },
        },
      }),
      // Groups with no members
      prisma.group.count({
        where: {
          deletedAt: null,
          members:   { none: {} },
        },
      }),
    ])

    const ready = totalGroups > 0 && totalManagerLinks > 0 && totalMembers > 0

    return reply.send({
      ready,
      counts: {
        groups:        totalGroups,
        managerLinks:  totalManagerLinks,
        members:       totalMembers,
      },
      warnings: [
        ...(managersWithNoGroups > 0 ? [`${managersWithNoGroups} manager(s) are not linked to any group — they cannot send broadcasts`] : []),
        ...(groupsWithNoManager  > 0 ? [`${groupsWithNoManager} group(s) have no manager assigned`] : []),
        ...(groupsWithNoMembers  > 0 ? [`${groupsWithNoMembers} group(s) have no members — broadcasts to these groups will send 0 messages`] : []),
      ],
    })
  })
}
