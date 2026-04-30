import { type FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { authenticate, requireRole } from '../middleware/rbac.js'

export async function authRoutes(app: FastifyInstance) {

  // ─── GET /auth/me ──────────────────────────────────────────────────────────

  app.get('/auth/me', { preHandler: [authenticate] }, async (req, reply) => {
    const { id, role } = req.user

    // Derive scope based on role — frontend uses this to decide what to render
    let scope: Record<string, unknown> = {}

    if (role === 'manager') {
      const groups = await prisma.managerGroup.findMany({
        where:  { managerId: id },
        select: { groupId: true },
      })
      scope = { managedGroupIds: groups.map(g => g.groupId) }
    }

    if (role === 'viewer') {
      // Two sources in parallel:
      // 1. Current group membership → full access (sees all conversations)
      // 2. Historical participant conversations → own-only access
      // Note: former managers (role changed to viewer) are treated as regular viewers —
      //       they see only their own participant conversations, not all historical data.
      const [currentLinks, historicalLinks] = await Promise.all([
        prisma.$queryRaw<{ manager_id: number; name: string }[]>`
          SELECT DISTINCT mg.manager_id, u.name
          FROM group_members gm
          JOIN manager_groups mg ON mg.group_id = gm.group_id
          JOIN users u ON u.id = mg.manager_id
          WHERE gm.user_id = ${id}
          AND u.role = 'manager'
        `,
        prisma.$queryRaw<{ manager_id: number; name: string }[]>`
          SELECT DISTINCT s.manager_id, u.name
          FROM conversations c
          JOIN broadcasts b ON b.id = c.broadcast_id
          JOIN schedules s ON s.id = b.schedule_id
          JOIN users u ON u.id = s.manager_id
          WHERE c.user_id = ${id}
        `,
      ])

      // Merge: 'full' wins over 'own' when a manager appears in both sources
      const map = new Map<number, { id: number; name: string; access: 'full' | 'own' }>()
      for (const r of historicalLinks) {
        map.set(r.manager_id, { id: r.manager_id, name: r.name, access: 'own' })
      }
      for (const r of currentLinks) {
        map.set(r.manager_id, { id: r.manager_id, name: r.name, access: 'full' })
      }
      const viewableManagers = [...map.values()]

      scope = {
        viewableManagers,
        viewableManagerIds: viewableManagers.map(m => m.id),
      }
    }

    return reply.send({ user: req.user, scope })
  })

  // ─── POST /auth/logout ────────────────────────────────────────────────────

  app.post('/auth/logout', { preHandler: [authenticate] }, async (req, reply) => {
    const token = req.headers.authorization!.slice(7)

    // Revoke the session on Supabase side
    await fetch(`${config.supabase.url}/auth/v1/logout`, {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey:        config.supabase.serviceRoleKey,
      },
    })

    return reply.status(204).send()
  })

  // ─── GET /integrations/status ─────────────────────────────────────────────

  app.get(
    '/integrations/status',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_req, reply) => {
      const maskPhone = (phone: string) =>
        phone.length > 7
          ? `${phone.slice(0, 4)}***${phone.slice(-4)}`
          : '***'

      return reply.send({
        twilio: {
          configured: !!config.twilio,
          ...(config.twilio && { fromNumber: maskPhone(config.twilio.fromNumber) }),
        },
        ai: {
          configured: !!config.ai,
          provider:   config.ai?.provider ?? null,
        },
      })
    }
  )
}
