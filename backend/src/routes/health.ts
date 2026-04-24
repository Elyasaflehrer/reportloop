import { type FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { redis } from '../redis.js'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const result = {
      status: 'ok' as 'ok' | 'degraded',
      db:     'ok' as 'ok' | 'error',
      redis:  'ok' as 'ok' | 'error',
      uptime: process.uptime(),
    }

    await Promise.all([
      prisma.$queryRaw`SELECT 1`.catch(() => { result.db = 'error' }),
      redis.ping().catch(() => { result.redis = 'error' }),
    ])

    if (result.db === 'error' || result.redis === 'error') {
      result.status = 'degraded'
      return reply.status(503).send(result)
    }

    return reply.send(result)
  })
}
