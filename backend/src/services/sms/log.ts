import { config } from '../../config.js'
import type { SmsSendResult } from './sms.provider.interface.js'

/**
 * Log a successful outbound SMS send (Phase 3 observability).
 *
 * Three callers — broadcast.service.ts, conversation.worker.ts,
 * reminder.worker.ts — each emit one of these per send. Centralized so
 * the log shape and the `config.logSmsBody` opt-in stay consistent.
 *
 * Pairs with the `[sms] received` and `[sms] status update` lines in
 * routes/webhooks.ts — same `messageId` value flows through the system
 * so all three can be correlated in Cloud Logging.
 *
 * Uses `console.info` because workers and services have no Fastify
 * request context (no `req.log`). Matches the rest of the worker logging
 * convention (`[broadcast-worker]`, `[reminder-worker]`, `[redis]`).
 *
 * @param result From {@link ISmsProvider.sendSmsDetailed}.
 * @param to     Recipient phone in E.164 format.
 * @param body   Message body. Length is logged; the body itself is
 *   included only when `LOG_SMS_BODY=true` (local-debug opt-in).
 */
export function logSmsSent(result: SmsSendResult, to: string, body: string): void {
  console.info({
    to,
    segments:  result.segments,
    status:    result.status,
    length:    body.length,
    messageId: result.messageId,
    ...(config.logSmsBody ? { body } : {}),
  }, '[sms] sent')
}
