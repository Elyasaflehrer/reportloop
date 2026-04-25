import { Worker } from 'bullmq'
import { redis } from '../redis.js'
import { config } from '../config.js'
import { runBroadcast } from '../services/broadcast.service.js'
import { createSmsProvider } from '../services/sms/sms.factory.js'
import { createAiProvider } from '../services/ai/ai.factory.js'

export function startBroadcastWorker() {
  // Providers are instantiated once per worker process — not per job
  const smsProvider = createSmsProvider()
  const aiProvider  = createAiProvider()

  const worker = new Worker(
    'broadcast',
    async (job) => {
      const { scheduleId, triggeredBy } = job.data as {
        scheduleId:   number
        triggeredBy?: number
      }

      await runBroadcast(scheduleId, smsProvider, aiProvider, triggeredBy)
    },
    {
      connection:  redis,
      concurrency: config.broadcast.concurrency,
    },
  )

  worker.on('failed', (job, err) => {
    console.error(
      `[broadcast-worker] job ${job?.id} failed (schedule ${job?.data?.scheduleId}): ${err.message}`,
    )
  })

  worker.on('completed', (job) => {
    console.info(
      `[broadcast-worker] job ${job.id} completed (schedule ${job.data?.scheduleId})`,
    )
  })

  return worker
}
