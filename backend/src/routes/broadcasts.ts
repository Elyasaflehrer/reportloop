import { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

const listBroadcastsQuery = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(30),
  scheduleId: z.coerce.number().int().positive().optional(),
  managerId:  z.coerce.number().int().positive().optional(),
})

type ViewerAccess = 'full' | 'own' | 'none'

// full  → viewer is currently in a group attached to this manager (sees all conversations)
// own   → viewer has past conversations from this manager but was removed from the group
// none  → no connection at all
async function viewerAccessLevel(viewerId: number, managerId: number): Promise<ViewerAccess> {
  // Current group membership AND manager still has active manager role → full access
  const link = await prisma.groupMember.findFirst({
    where: {
      userId: viewerId,
      group: { managerLinks: { some: { managerId, manager: { role: 'manager' } } } },
    },
    select: { userId: true },
  })
  if (link) return 'full'

  // Historical participant conversations → own-only access
  const conv = await prisma.conversation.findFirst({
    where: { userId: viewerId, broadcast: { schedule: { managerId } } },
    select: { id: true },
  })
  return conv ? 'own' : 'none'
}

export async function broadcastsRoutes(app: FastifyInstance) {

  // ─── GET /broadcasts ───────────────────────────────────────────────────────

  app.get('/broadcasts', { preHandler: [authenticate, requireRole('admin', 'manager', 'participant', 'viewer')] }, async (req, reply) => {
    const query = listBroadcastsQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const { page, limit, scheduleId, managerId } = query.data
    const skip = (page - 1) * limit

    let viewerAccess: ViewerAccess | null = null
    if (req.user.role === 'viewer') {
      if (!managerId) return reply.status(400).send({ error: 'managerId query param is required for viewer' })
      viewerAccess = await viewerAccessLevel(req.user.id, managerId)
      if (viewerAccess === 'none') return reply.status(403).send({ error: 'Forbidden' })
    }

    const where = {
      schedule: {
        deletedAt: null,
        ...(req.user.role === 'manager'     && { managerId: req.user.id }),
        ...(req.user.role === 'viewer'      && { managerId }),
        // participant can scope to one manager's broadcasts for grouped display
        ...(req.user.role === 'participant' && managerId && { managerId }),
      },
      ...(scheduleId && { scheduleId }),
      // participant or viewer with own-only access: only broadcasts where this user has a conversation
      ...((req.user.role === 'participant' || (req.user.role === 'viewer' && viewerAccess === 'own')) && {
        conversations: { some: { userId: req.user.id } },
      }),
    }

    const [broadcasts, total] = await Promise.all([
      prisma.broadcast.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { triggeredAt: 'desc' },
        select: {
          id:          true,
          scheduleId:  true,
          fireDate:    true,
          status:      true,
          triggeredAt: true,
          schedule: {
            select: { label: true, managerId: true },
          },
          conversations: {
            // participant or viewer with own-only access: only count their own conversation
            where: (req.user.role === 'participant' || (req.user.role === 'viewer' && viewerAccess === 'own'))
              ? { userId: req.user.id }
              : undefined,
            select: { status: true },
          },
        },
      }),
      prisma.broadcast.count({ where }),
    ])

    return reply.send({
      data: broadcasts.map(b => {
        const convs = b.conversations
        return {
          id:            b.id,
          scheduleId:    b.scheduleId,
          scheduleLabel: b.schedule.label ?? null,
          managerId:     b.schedule.managerId,
          fireDate:      b.fireDate,
          status:        b.status,
          triggeredAt:   b.triggeredAt,
          stats: {
            total:          convs.length,
            completed:      convs.filter(c => c.status === 'completed').length,
            failed:         convs.filter(c => c.status === 'failed' || c.status === 'timed_out').length,
            awaiting_reply: convs.filter(c => c.status === 'awaiting_reply').length,
            pending:        convs.filter(c => c.status === 'pending').length,
          },
          conversations: undefined,
        }
      }),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    })
  })

  // ─── GET /broadcasts/:id/conversations ─────────────────────────────────────

  app.get('/broadcasts/:id/conversations', { preHandler: [authenticate, requireRole('admin', 'manager', 'participant', 'viewer')] }, async (req, reply) => {
    const broadcastId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(broadcastId)) return reply.status(400).send({ error: 'Invalid broadcast id' })

    // Verify access
    const broadcast = await prisma.broadcast.findFirst({
      where: {
        id:       broadcastId,
        schedule: {
          deletedAt: null,
          ...(req.user.role === 'manager' && { managerId: req.user.id }),
        },
        ...(req.user.role === 'participant' && {
          conversations: { some: { userId: req.user.id } },
        }),
      },
      select: { id: true, schedule: { select: { managerId: true } } },
    })
    if (!broadcast) return reply.status(404).send({ error: 'Broadcast not found' })

    let convViewerAccess: ViewerAccess | null = null
    if (req.user.role === 'viewer') {
      convViewerAccess = await viewerAccessLevel(req.user.id, broadcast.schedule.managerId)
      if (convViewerAccess === 'none') return reply.status(403).send({ error: 'Forbidden' })
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        broadcastId,
        // participant or viewer with own-only access: only their own conversation
        ...((req.user.role === 'participant' || (req.user.role === 'viewer' && convViewerAccess === 'own')) && {
          userId: req.user.id,
        }),
      },
      orderBy: { startedAt: 'asc' },
      select: {
        id:            true,
        status:        true,
        startedAt:     true,
        completedAt:   true,
        lastMessageAt: true,
        failReason:    true,
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    })

    return reply.send({
      data: conversations.map(c => ({
        id:            c.id,
        userId:        c.user.id,
        userName:      c.user.name,
        userPhone:     c.user.phone,
        status:        c.status,
        startedAt:     c.startedAt,
        completedAt:   c.completedAt,
        lastMessageAt: c.lastMessageAt,
        failReason:    c.failReason,
      })),
    })
  })

  // ─── GET /conversations/:id ────────────────────────────────────────────────

  app.get('/conversations/:id', { preHandler: [authenticate, requireRole('admin', 'manager', 'participant', 'viewer')] }, async (req, reply) => {
    const conversationId = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(conversationId)) return reply.status(400).send({ error: 'Invalid conversation id' })

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        // participant can only open their own conversation
        ...(req.user.role === 'participant' && { userId: req.user.id }),
        broadcast: {
          schedule: {
            deletedAt: null,
            ...(req.user.role === 'manager' && { managerId: req.user.id }),
          },
        },
      },
      select: {
        id:          true,
        status:      true,
        startedAt:   true,
        completedAt: true,
        failReason:  true,
        user: {
          select: { id: true, name: true, phone: true },
        },
        messages: {
          orderBy: { sentAt: 'asc' },
          select:  { id: true, role: true, body: true, sentAt: true },
        },
        answers: {
          orderBy: { createdAt: 'asc' },
          select: {
            id:       true,
            answer:   true,
            question: { select: { id: true, text: true } },
          },
        },
        broadcast: {
          select: { schedule: { select: { managerId: true } } },
        },
      },
    })

    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' })

    if (req.user.role === 'viewer') {
      const access = await viewerAccessLevel(req.user.id, conversation.broadcast.schedule.managerId)
      if (access === 'none') return reply.status(403).send({ error: 'Forbidden' })
      if (access === 'own' && conversation.user.id !== req.user.id) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
    }

    return reply.send({
      id:          conversation.id,
      userId:      conversation.user.id,
      userName:    conversation.user.name,
      userPhone:   conversation.user.phone,
      status:      conversation.status,
      startedAt:   conversation.startedAt,
      completedAt: conversation.completedAt,
      failReason:  conversation.failReason,
      messages:    conversation.messages.map(m => ({ role: m.role, body: m.body, sentAt: m.sentAt })),
      answers:     conversation.answers.map(a => ({
        questionId:   a.question.id,
        questionText: a.question.text,
        answer:       a.answer,
      })),
    })
  })
}
