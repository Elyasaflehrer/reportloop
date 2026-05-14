import type { FastifyRequest } from 'fastify'

/**
 * Provider-agnostic interface for sending and receiving SMS messages.
 *
 * Each concrete provider (Twilio, mock, future Vonage/AWS SNS, etc.)
 * implements this interface. Business logic (workers, services, the
 * webhook handler) never imports a provider directly — only this
 * interface.
 *
 * Two of the methods (`sendSmsDetailed`, `parseWebhookEvent`) are being
 * phased in to replace the older `sendSms` and `parseInboundWebhook`.
 * Once all callers migrate, the old methods are removed and the new
 * ones become required (see sms-provider-abstraction-plan.md).
 */
export interface ISmsProvider {
  /**
   * Send an SMS message via the provider.
   *
   * @param to   Recipient phone number in E.164 format.
   * @param body Message text (subject to provider-specific length limits).
   * @param from Sender phone number in E.164 format — must be owned by us.
   * @returns The provider's unique message identifier (e.g. Twilio SID).
   * @throws SmsDeliveryError on transient provider failure.
   *
   * @deprecated Use {@link ISmsProvider.sendSmsDetailed} which returns
   *   richer result data. This signature will be removed in the cleanup
   *   step of the provider-abstraction refactor.
   */
  sendSms(to: string, body: string, from: string): Promise<string>

  /**
   * Send an SMS message and return structured result data.
   *
   * Same delivery semantics as {@link ISmsProvider.sendSms}, but the
   * return value also includes the segment count and initial status from
   * the provider's API response — used by Phase 3 cost-observability
   * logging.
   *
   * @param to   Recipient phone number in E.164 format.
   * @param body Message text.
   * @param from Sender phone number in E.164 format.
   * @returns An {@link SmsSendResult} with messageId, segments, and status.
   */
  sendSmsDetailed?(to: string, body: string, from: string): Promise<SmsSendResult>

  /**
   * Provision a new phone number from the provider's available inventory
   * and configure it to send SMS webhooks to the given URL.
   *
   * Used by per-manager phone-number assignment
   * (see phone-number.service.ts).
   *
   * @param params.webhookUrl URL the provider will POST inbound SMS to.
   * @param params.country    ISO 3166-1 alpha-2 country code (e.g. 'US').
   * @param params.numberType 'local', 'tollFree', or 'mobile'
   *   (provider-dependent).
   * @returns The purchased number in E.164 format and the provider's
   *   internal SID for it.
   */
  provisionNumber(params: {
    webhookUrl: string
    country:    string
    numberType: string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }>

  /**
   * Verify that a webhook request was actually sent by the provider.
   *
   * Reads the provider's signature header (e.g. `X-Twilio-Signature`) and
   * recomputes the expected signature using the shared auth secret.
   * Returns `false` on missing or invalid signature, or on any exception
   * during validation.
   *
   * MUST be called before trusting any field from the request body.
   *
   * @param req Fastify request as received from the provider's webhook.
   * @returns `true` if the request is authentically from the provider.
   */
  validateWebhookSignature(req: FastifyRequest): boolean

  /**
   * Extract the basic inbound-SMS fields from a webhook request.
   *
   * @param req Fastify request — caller MUST have validated the signature.
   * @returns The {from, to, body, messageId} fields parsed from the body.
   *
   * @deprecated Use {@link ISmsProvider.parseWebhookEvent} which also
   *   covers status callbacks and includes segment count. Will be removed
   *   in the cleanup step.
   */
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload

  /**
   * Extract a normalized {@link WebhookEvent} from a webhook request.
   *
   * Replaces {@link ISmsProvider.parseInboundWebhook} with a richer return
   * that distinguishes (a) an inbound SMS sent by a participant from
   * (b) a status callback updating the delivery state of a message we
   * previously sent. The handler branches on `event.type`.
   *
   * @param req Fastify request — caller MUST have validated the signature.
   * @returns A discriminated {@link WebhookEvent}: `inbound` or `status`.
   */
  parseWebhookEvent?(req: FastifyRequest): WebhookEvent
}

// ────────────────────────────────────────────────────────────────────────────
// Result + event types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of a successful SMS send.
 *
 * Returned by {@link ISmsProvider.sendSmsDetailed}. Captures the fields we
 * care about from the provider's API response: the message ID for
 * tracking, segment count for cost monitoring, and the initial status
 * for delivery debugging.
 */
export interface SmsSendResult {
  /** Provider's unique message identifier (e.g. Twilio SID like `SMxxx`). */
  messageId: string

  /**
   * Number of SMS segments the body was split into.
   * Drives per-segment billing.
   */
  segments: number

  /**
   * Initial delivery status, e.g. `'queued'` or `'sent'`.
   * Provider-specific vocabulary.
   */
  status: string
}

/**
 * Discriminated union representing a single webhook event.
 *
 * Providers POST both inbound messages and delivery status callbacks to
 * the same endpoint. The `type` field discriminates between them; callers
 * narrow with `if (event.type === 'inbound')` to access the right fields.
 *
 * - `'inbound'`: a participant texted one of our numbers. Body present.
 * - `'status'`:  delivery state update for a message we previously sent.
 *   No body (the participant isn't sending us text — the provider is
 *   reporting on the delivery of our earlier message).
 */
export type WebhookEvent =
  | {
      /** Discriminator: inbound SMS from a participant. */
      type: 'inbound'

      /** Sender's phone (E.164) — the participant. */
      from: string

      /** Recipient phone (E.164) — one of our manager numbers. */
      to: string

      /** Message text as sent by the participant. */
      body: string

      /** Provider's message identifier for idempotency / DB lookup. */
      messageId: string

      /** Number of segments the inbound message arrived in. */
      segments: number

      /**
       * Count of media attachments.
       * 0 for plain SMS; >0 indicates MMS (handler currently rejects MMS).
       */
      numMedia: number
    }
  | {
      /** Discriminator: delivery status callback. */
      type: 'status'

      /** Phone (E.164) the message was sent from — one of our numbers. */
      from: string

      /** Phone (E.164) the message was sent to — the participant. */
      to: string

      /**
       * Provider's message identifier — matches the `messageId` returned
       * by {@link ISmsProvider.sendSmsDetailed} when we sent it.
       */
      messageId: string

      /**
       * Current delivery state.
       * Typical values: `queued` | `sending` | `sent` | `delivered` |
       * `failed` | `undelivered` (provider-specific).
       */
      status: string

      /** Segment count, for cross-referencing the outbound log line. */
      segments: number

      /** Provider error code on `failed` / `undelivered`. */
      errorCode?: string

      /** Human-readable error description on `failed` / `undelivered`. */
      errorMessage?: string
    }

/**
 * Basic inbound SMS payload — the original shape returned by
 * {@link ISmsProvider.parseInboundWebhook}.
 *
 * @deprecated Use the `'inbound'` arm of {@link WebhookEvent} instead.
 *   Kept only to satisfy the old method signature during the migration
 *   window.
 */
export type InboundSmsPayload = {
  /** Participant's phone (the webhook's `From` field). */
  from: string

  /** Manager's number (the webhook's `To` field). */
  to: string

  /** Message body text. */
  body: string

  /** Provider's message identifier. */
  messageId: string
}
