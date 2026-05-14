import { type FastifyInstance } from 'fastify'
import { inboundQueue } from '../jobs/queue.js'
import { config } from '../config.js'
import type { InboundJob } from '../jobs/inbound.worker.js'
import type { ISmsProvider } from '../services/sms/sms.provider.interface.js'

// ─── POST /webhooks/twilio ────────────────────────────────────────────────────
// Twilio webhook endpoint. Acts as a thin gate:
//   1. Validate the X-Twilio-Signature header
//   2. Normalize the payload via the provider's parseWebhookEvent
//   3. Run cheap guards (missing fields, MMS rejection)
//   4. Log the event (Phase 3 observability — see sms-cost-reduction-plan.md)
//   5. Enqueue to inboundQueue and return 200 immediately
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

      // ── Event extraction ────────────────────────────────────────────────────
      // Provider-agnostic — Twilio-specific field names live in the provider's
      // parseWebhook implementation.
      const event = smsProvider.parseWebhook(req)

      // ── Missing-fields guard (Cases 6, 16, 17, 25) ──────────────────────────
      // Drop malformed payloads silently with 200 — Twilio shouldn't retry.
      // Applies to both event types: every webhook should have from/to/messageId.
      if (!event.from || !event.to || !event.messageId) {
        req.log.warn(
          { from: event.from, to: event.to, messageId: event.messageId },
          '[webhook] missing required fields',
        )
        return reply.status(200).send()
      }

      // ── Status callbacks (delivery state updates) ───────────────────────────
      if (event.type === 'status') {
        // Phase 3 status-callback log line. Surfaces delivery failures
        // (`undelivered`, `failed` with error code) that would otherwise be
        // invisible. errorCode/errorMessage are present only on failures.
        req.log.info(
          {
            messageId:    event.messageId,
            status:       event.status,
            segments:     event.segments,
            errorCode:    event.errorCode,
            errorMessage: event.errorMessage,
          },
          '[sms] status update',
        )

        // NOTE: jobId reuses messageId, so subsequent status updates for the
        // same message (queued → sent → delivered) overlap in BullMQ's dedup
        // window. This preserves pre-refactor behavior; revisit if
        // status-update ordering becomes important downstream.
        const data: InboundJob = {
          from:   event.from,
          to:     event.to,
          text:   '',                  // status callbacks carry no body
          smsSid: event.messageId,
          status: event.status,
        }
        try {
          await inboundQueue.add('inbound', data, { jobId: event.messageId })
        } catch (err) {
          req.log.error({ err }, '[webhook] Redis unavailable — enqueue failed')
          return reply.status(500).send()  // Twilio will retry
        }
        return reply.status(200).send()
      }

      // event.type === 'inbound' — narrowed by the if-return above.

      // ── MMS guard (Case 26) ─────────────────────────────────────────────────
      // SMS only — multimedia messages are dropped before Redis write.
      // Kept in the handler (not parseWebhookEvent) so the provider layer
      // stays free of business policy.
      if (event.numMedia > 0) {
        req.log.info(
          { from: event.from, messageId: event.messageId, numMedia: event.numMedia },
          '[webhook] MMS rejected — SMS only',
        )
        return reply.status(200).send()
      }

      // ── Phase 3 inbound log ────────────────────────────────────────────────
      // Metadata only by default. `config.logSmsBody=true` opts in to
      // including the body for local debugging — never set in production
      // since bodies are PII and shouldn't leak to Cloud Logging.
      req.log.info(
        {
          from:      event.from,
          segments:  event.segments,
          length:    event.body.length,
          messageId: event.messageId,
          ...(config.logSmsBody ? { body: event.body } : {}),
        },
        '[sms] received',
      )

      // ── Enqueue + return ────────────────────────────────────────────────────
      // jobId: event.messageId is Layer 1 idempotency — duplicate Twilio
      // retries while the job is still in the queue are deduped by BullMQ.
      // Layer 2 lives in the worker (message.findUnique by twilioSid).
      const data: InboundJob = {
        from:   event.from,
        to:     event.to,
        text:   event.body,
        smsSid: event.messageId,
        status: '',                    // inbound messages have no status field
      }
      try {
        await inboundQueue.add('inbound', data, { jobId: event.messageId })
      } catch (err) {
        req.log.error({ err }, '[webhook] Redis unavailable — enqueue failed')
        return reply.status(500).send()  // Twilio will retry
      }
      return reply.status(200).send()
    },
  )
}
