import { Queue } from 'bullmq'
import { redis } from '../redis.js'

// ─── Broadcast queue ──────────────────────────────────────────────────────────
// Jobs enqueued by the scheduler (Step 18) and the manual trigger endpoint.
// Each job carries { scheduleId, triggeredBy? }.

export const broadcastQueue = new Queue('broadcast', {
  connection:     redis,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 500 },
  },
})

// ─── Conversation queue ───────────────────────────────────────────────────────
// Jobs enqueued by the inbound webhook when a participant replies.
// Each job carries { conversationId, messageBody, from }.

export const conversationQueue = new Queue('conversation', {
  connection: redis,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
})

// ─── Reminder queue ───────────────────────────────────────────────────────────
// Not a BullMQ queue — reminders are driven by a node-cron job (Step 19).
// Defined here as a placeholder so imports stay consistent.
export const REMINDER_CRON = '*/15 * * * *'  // every 15 minutes
