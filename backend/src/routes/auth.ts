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
      // Viewer sees conversations for all managers in groups the viewer belongs to
      const managerLinks = await prisma.$queryRaw<{ manager_id: number }[]>`
        SELECT DISTINCT mg.manager_id
        FROM group_members gm
        JOIN manager_groups mg ON mg.group_id = gm.group_id
        WHERE gm.user_id = ${id}
      `
      scope = { viewableManagerIds: managerLinks.map(r => r.manager_id) }
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
