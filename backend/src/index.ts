import 'dotenv/config'
import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './db.js'
import { startBroadcastWorker } from './jobs/broadcast.worker.js'
import { startConversationWorker } from './jobs/conversation.worker.js'
import { startScheduler } from './jobs/scheduler.js'
import { startReminderWorker } from './jobs/reminder.worker.js'
import { createSmsProvider } from './services/sms/sms.factory.js'

async function start() {
  const app = await buildApp()

  // ─── WORKERS ──────────────────────────────────────────────────────────────

  let broadcastWorker:     Awaited<ReturnType<typeof startBroadcastWorker>>     | undefined
  let conversationWorker:  Awaited<ReturnType<typeof startConversationWorker>>  | undefined

  let reminderWorker: ReturnType<typeof startReminderWorker> | undefined

  if (config.twilio && config.ai) {
    broadcastWorker    = startBroadcastWorker()
    conversationWorker = startConversationWorker()
    app.log.info('[workers] broadcast + conversation workers started')
  } else {
    app.log.warn('[workers] broadcast + conversation workers skipped — Twilio or AI provider not configured')
  }

  if (config.twilio) {
    const smsProvider = createSmsProvider()
    reminderWorker = startReminderWorker(smsProvider)
    app.log.info('[workers] reminder worker started')
  } else {
    app.log.warn('[workers] reminder worker skipped — Twilio not configured')
  }

  const scheduler = startScheduler()

  // ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down gracefully`)

    try {
      await app.close()

      if (broadcastWorker)    await broadcastWorker.close()
      if (conversationWorker) await conversationWorker.close()
      if (reminderWorker)     reminderWorker.stop()
      scheduler.stop()

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
