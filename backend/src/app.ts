import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { config } from './config.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { usersRoutes } from './routes/users.js'
import { groupsRoutes } from './routes/groups.js'
import { participantsRoutes } from './routes/participants.js'
import { questionsRoutes } from './routes/questions.js'
import { schedulesRoutes } from './routes/schedules.js'
import { webhooksRoutes } from './routes/webhooks.js'
import { createSmsProvider } from './services/sms/sms.factory.js'
import type { ISmsProvider } from './services/sms/sms.provider.interface.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.node_env === 'test' ? 'silent' : 'info',
      ...(config.node_env === 'development' && {
        transport: { target: 'pino-pretty', options: { colorize: true } },
      }),
    },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  })

  // ─── PLUGINS ──────────────────────────────────────────────────────────────

  await app.register(helmet)

  await app.register(cors, {
    origin: config.app.frontendOrigin,
    credentials: true,
  })

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: {
        code:    'RATE_LIMITED',
        message: `Too many requests — try again in ${context.after}`,
      },
    }),
  })

  // ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────

  app.setErrorHandler((error, req, reply) => {
    const statusCode = error.statusCode ?? 500

    if (statusCode >= 500) {
      req.log.error({ err: error, requestId: req.id }, 'Unhandled error')
    }

    reply.status(statusCode).send({
      error: {
        code:      error.code ?? 'INTERNAL_ERROR',
        message:   statusCode >= 500 && config.node_env === 'production'
                     ? 'An unexpected error occurred'
                     : error.message,
        requestId: req.id,
      },
    })
  })

  // ─── ROUTES ───────────────────────────────────────────────────────────────
  // Registered here as each step is implemented:
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(usersRoutes)
  await app.register(groupsRoutes)
  await app.register(participantsRoutes)
  await app.register(questionsRoutes)
  await app.register(schedulesRoutes)

  if (config.twilio) {
    const smsProvider: ISmsProvider = createSmsProvider()
    await app.register(webhooksRoutes, { smsProvider })
  }

  // Step 21: conversation worker

  return app
}
