import type { FastifyRequest } from 'fastify'
import type {
  ISmsProvider,
  SmsSendResult,
  WebhookEvent,
} from '../sms.provider.interface.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One recorded interaction with the mock provider.
 *
 * Tests inspect the call log via {@link MockSmsProvider.getCallLog} to
 * assert that the right side effects happened.
 */
export type MockSmsCall =
  | {
      kind:      'sendSms'
      to:        string
      body:      string
      from:      string
      messageId: string
      at:        string
    }
  | {
      kind:             'provisionNumber'
      country:          string
      numberType:       string
      webhookUrl:       string
      assignedPhone:    string
      assignedPhoneSid: string
      at:               string
    }

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * In-process mock {@link ISmsProvider} for tests and local dev.
 *
 * Tracks every call in an inspectable log, generates deterministic mock
 * phone numbers and message IDs, and accepts any webhook signature.
 *
 * The mock-specific webhook payload uses lowercase JSON fields
 * (`from`, `to`, `body`, ...), distinct from Twilio's capitalized
 * form-encoded keys. Tests construct payloads in this shape.
 */
export class MockSmsProvider implements ISmsProvider {
  private callLog:        MockSmsCall[] = []
  private numberCounter  = 0
  private messageCounter = 0

  // ─── ISmsProvider implementation ───────────────────────────────────────────

  async provisionNumber(params: {
    webhookUrl: string
    country:    string
    numberType: string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }> {
    this.numberCounter += 1
    const padded = this.numberCounter.toString().padStart(4, '0')
    const result = {
      assignedPhone:    `+1555000${padded}`,
      assignedPhoneSid: `MOCKPN${padded}`,
    }
    this.callLog.push({
      kind:             'provisionNumber',
      country:          params.country,
      numberType:       params.numberType,
      webhookUrl:       params.webhookUrl,
      assignedPhone:    result.assignedPhone,
      assignedPhoneSid: result.assignedPhoneSid,
      at:               new Date().toISOString(),
    })
    return result
  }

  /**
   * Mock send returning structured {@link SmsSendResult}.
   *
   * Generates a deterministic `MOCKMSG######` message ID, records the
   * call in the log, and returns segments=1 / status='queued'. Tests
   * that need other values would override (not currently parameterizable).
   */
  async sendSms(to: string, body: string, from: string): Promise<SmsSendResult> {
    this.messageCounter += 1
    const messageId = `MOCKMSG${this.messageCounter.toString().padStart(6, '0')}`
    this.callLog.push({
      kind: 'sendSms',
      to,
      body,
      from,
      messageId,
      at:   new Date().toISOString(),
    })
    return {
      messageId,
      segments: 1,         // mock always assumes single-segment; tests don't exercise multi-segment yet
      status:   'queued',  // mirrors Twilio's initial status
    }
  }

  validateWebhookSignature(_req: FastifyRequest): boolean {
    // v1: always accept. Header-driven rejection lands when a webhook-signature
    // test needs it.
    return true
  }

  /**
   * Normalize a mock webhook payload into a {@link WebhookEvent}.
   *
   * Mock webhooks are JSON with lowercase field names. The presence of a
   * `status` field in the payload triggers the `'status'` variant — same
   * discriminator pattern as Twilio's `MessageStatus`. Otherwise treated
   * as an inbound message.
   *
   * `segments` defaults to 1 since the mock doesn't model multi-segment
   * messages; `numMedia` defaults to 0 (no MMS in tests yet).
   */
  parseWebhook(req: FastifyRequest): WebhookEvent {
    const body = req.body as Record<string, string>

    if (body.status) {
      return {
        type:         'status',
        from:         body.from      ?? '',
        to:           body.to        ?? '',
        messageId:    body.messageId ?? '',
        status:       body.status,
        segments:     Number(body.segments  ?? '1'),
        errorCode:    body.errorCode    || undefined,
        errorMessage: body.errorMessage || undefined,
      }
    }

    return {
      type:      'inbound',
      from:      body.from      ?? '',
      to:        body.to        ?? '',
      body:      (body.body ?? '').trim(),
      messageId: body.messageId ?? '',
      segments:  Number(body.segments ?? '1'),
      numMedia:  Number(body.numMedia ?? '0'),
    }
  }

  // ─── Mock-only inspection (not on ISmsProvider) ────────────────────────────

  getCallLog(): readonly MockSmsCall[] {
    return this.callLog
  }

  clearCallLog(): void {
    this.callLog        = []
    this.numberCounter  = 0
    this.messageCounter = 0
  }
}
