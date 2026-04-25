import 'dotenv/config'
import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'
import { startBroadcastWorker } from './jobs/broadcast.worker.js'
import { startScheduler } from './jobs/scheduler.js'

async function start() {
  const app = await buildApp()

  // ─── WORKERS ──────────────────────────────────────────────────────────────

  let broadcastWorker: Awaited<ReturnType<typeof startBroadcastWorker>> | undefined

  if (config.twilio && config.ai) {
    broadcastWorker = startBroadcastWorker()
    app.log.info('[workers] broadcast worker started')
  } else {
    app.log.warn('[workers] broadcast worker skipped — Twilio or AI provider not configured')
  }

  const scheduler = startScheduler()

  // ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down gracefully`)

    try {
      await app.close()

      if (broadcastWorker) await broadcastWorker.close()
      scheduler.stop()
      // await conversationWorker.close()  — Step 20
      // await reminderWorker.close()      — Step 19

      await prisma.$disconnect()

      app.log.info('Shutdown complete')
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))

  // ─── START ────────────────────────────────────────────────────────────────

  try {
    await app.listen({ port: config.app.port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err, 'Failed to start server')
    process.exit(1)
  }
}

start()
