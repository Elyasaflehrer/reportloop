import cron from 'node-cron'
import { prisma } from '../db.js'
import { config } from '../config.js'

export function startCleanupWorker() {
  // Runs at 02:00 every night
  const task = cron.schedule('0 2 * * *', async () => {
    try {
      await runCleanup()
    } catch (err) {
      console.error('[cleanup-worker] error:', err)
    }
  })

  console.info('[cleanup-worker] started — running nightly at 02:00')
  return task
}

async function runCleanup() {
  if (config.conversation.retentionDays === 0) return  // 0 = keep forever

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - config.conversation.retentionDays)

  // Hard delete old conversations in terminal states + their messages and answers
  // (cascades via Prisma onDelete: Cascade on messages and answers)
  const result = await prisma.conversation.deleteMany({
    where: {
      status:     { in: ['completed', 'failed', 'timed_out', 'superseded'] },
      startedAt:  { lte: cutoff },
    },
  })

  if (result.count > 0) {
    console.info(`[cleanup-worker] deleted ${result.count} conversation(s) older than ${config.conversation.retentionDays} days`)
  }
}
