import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'

async function start() {
  const app = await buildApp()

  // ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down gracefully`)

    try {
      await app.close()          // stop accepting new HTTP requests

      // Workers and scheduler are closed here as they are added:
      // await broadcastWorker.close()
      // await conversationWorker.close()
      // await reminderWorker.close()
      // scheduler.stop()

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
