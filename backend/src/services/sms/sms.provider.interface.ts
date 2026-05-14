import type { FastifyRequest } from 'fastify'

/**
 * Provider-agnostic interface for sending and receiving SMS messages.
 *
 * Each concrete provider (Twilio, mock, future Vonage/AWS SNS, etc.)
 * implements this interface. Business logic (workers, services, the
 * webhook handler) never imports a provider directly — only this
 * interface.
 */
export interface ISmsProvider {
  /**
   * Send an SMS message via the provider.
   *
   * @param to   Recipient phone number in E.164 format.
   * @param body Message text (subject to provider-specific length limits).
   * @param from Sender phone number in E.164 format — must be owned by us.
   * @returns An {@link SmsSendResult} with messageId, segments, and status.
   * @throws Provider-specific delivery / auth errors.
   */
  sendSms(to: string, body: string, from: string): Promise<SmsSendResult>

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
   * Extract a normalized {@link WebhookEvent} from a webhook request.
   *
   * Providers POST both inbound messages and delivery status callbacks
   * to the same endpoint. This method returns a discriminated union so
   * the handler can branch on `event.type` and access only the fields
   * that exist for that variant.
   *
   * @param req Fastify request — caller MUST have validated the signature.
   * @returns A {@link WebhookEvent}: `'inbound'` or `'status'`.
   */
  parseWebhook(req: FastifyRequest): WebhookEvent
}

// ────────────────────────────────────────────────────────────────────────────
// Result + event types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of a successful SMS send.
 *
 * Returned by {@link ISmsProvider.sendSms}. Captures the fields we care
 * about from the provider's API response: the message ID for tracking,
 * segment count for cost monitoring, and the initial status for
 * delivery debugging.
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
       * by {@link ISmsProvider.sendSms} when we sent it.
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
