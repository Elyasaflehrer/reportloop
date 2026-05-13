import { Queue, type WorkerOptions } from 'bullmq'
import { redis } from '../redis.js'
import { config } from '../config.js'

// ─── Shared worker options ────────────────────────────────────────────────────
// Spread into each `new Worker(...)` call so polling cadence and metrics are
// tuned consistently across queues. Per-workload knobs (concurrency, etc.)
// stay at the call site.
export const defaultWorkerOpts: Pick<WorkerOptions, 'connection' | 'stalledInterval' | 'maxStalledCount' | 'metrics'> = {
  connection:      redis,
  stalledInterval: config.worker.stalledIntervalMs,
  maxStalledCount: config.worker.maxStalledCount,
  metrics:         { maxDataPoints: config.worker.metricsMaxDataPoints },
}

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

// ─── Inbound queue ────────────────────────────────────────────────────────────
// Jobs enqueued by the Twilio webhook (routes/webhooks.ts) for any inbound
// payload — SMS replies, STOP/START opt-out, and delivery status callbacks.
// Each job carries an InboundJob (see jobs/inbound.worker.ts).
//
// Retry policy is more aggressive than other queues — webhook deliveries are
// time-sensitive and DB blips should recover fast (~31s total window).

export const inboundQueue = new Queue('inbound', {
  connection: redis,
  defaultJobOptions: {
    attempts:    5,
    backoff:     { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
})

// ─── Conversation queue ───────────────────────────────────────────────────────
// Jobs enqueued by inbound.worker.ts after a participant reply has been
// validated, locked, and persisted. Drives AI processing of the conversation.
// Each job carries { conversationId }.

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
