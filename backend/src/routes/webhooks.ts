import { type FastifyInstance } from 'fastify'
import { inboundQueue } from '../jobs/queue.js'
import type { InboundJob } from '../jobs/inbound.worker.js'
import type { ISmsProvider } from '../services/sms/sms.provider.interface.js'

// ─── POST /webhooks/twilio ────────────────────────────────────────────────────
// Twilio webhook endpoint. Acts as a thin gate:
//   1. Validate the X-Twilio-Signature header
//   2. Extract the payload fields
//   3. Run cheap guards (missing fields, MMS rejection)
//   4. Enqueue to inboundQueue and return 200 immediately
//
// All business logic — DB lookups, conversation locking, message persistence,
// downstream dispatch — lives in jobs/inbound.worker.ts. Returning 200 fast
// keeps us well within Twilio's 15s webhook timeout. Failed Redis writes
// return 500 so Twilio retries.

export async function webhooksRoutes(
  app: FastifyInstance,
  opts: { smsProvider: ISmsProvider },
) {
  const { smsProvider } = opts

  app.post(
    '/webhooks/twilio',
    {
      // Exempt from the global @fastify/rate-limit (Case 14). Signature
      // validation already filters non-Twilio requests, so there's no abuse
      // risk from skipping the rate limiter on this route.
      config: { rateLimit: false },
    },
    async (req, reply) => {
      // ── Signature validation (Case 23) ──────────────────────────────────────
      // Same outcome for invalid signature and unexpected SDK throw — return
      // 403 either way so non-Twilio callers can't probe for differences.
      try {
        if (!smsProvider.validateWebhookSignature(req)) {
          return reply.status(403).send()
        }
      } catch {
        return reply.status(403).send()
      }

      // ── Field extraction ────────────────────────────────────────────────────
      const raw    = req.body as Record<string, string>
      const from   = raw.From          ?? ''
      const to     = raw.To            ?? ''
      const text   = (raw.Body ?? '').trim()
      const smsSid = raw.MessageSid ?? raw.SmsSid ?? ''
      const status = raw.MessageStatus ?? ''

      // ── Missing-fields guard (Cases 6, 16, 17, 25) ──────────────────────────
      // Drop malformed payloads silently with 200 — Twilio shouldn't retry.
      if (!from || !to || !smsSid) {
        req.log.warn({ from, to, smsSid }, '[webhook] missing required fields')
        return reply.status(200).send()
      }

      // ── MMS guard (Case 26) ─────────────────────────────────────────────────
      // SMS only — multimedia messages are dropped before Redis write.
      if (parseInt(raw.NumMedia ?? '0') > 0) {
        req.log.info({ from, to, smsSid }, '[webhook] MMS rejected — SMS only')
        return reply.status(200).send()
      }

      // ── Enqueue + return ────────────────────────────────────────────────────
      // jobId: smsSid is Layer 1 idempotency — duplicate Twilio retries while
      // the job is still in the queue are deduped by BullMQ. Layer 2 lives in
      // the worker (message.findUnique by twilioSid).
      const data: InboundJob = { from, to, text, smsSid, status }
      try {
        await inboundQueue.add('inbound', data, { jobId: smsSid })
      } catch (err) {
        req.log.error({ err }, '[webhook] Redis unavailable — enqueue failed')
        return reply.status(500).send()  // Twilio will retry the webhook
      }
      return reply.status(200).send()
    },
  )
}
