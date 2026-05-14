import twilio from 'twilio'
import type { FastifyRequest } from 'fastify'
import type {
  ISmsProvider,
  SmsSendResult,
  WebhookEvent,
} from '../sms.provider.interface.js'
import { config } from '../../../config.js'

/**
 * Thrown when Twilio rejects a send attempt for any reason other than
 * authentication. Wraps the upstream error message and (when present)
 * the Twilio error code so callers can branch on it.
 */
export class SmsDeliveryError extends Error {
  constructor(message: string, public readonly code?: string | number) {
    super(message)
    this.name = 'SmsDeliveryError'
  }
}

/**
 * Thrown when Twilio returns error code 20003 (bad credentials).
 * Surfaced separately because it's a configuration problem, not a
 * transient send failure — should bubble up to the operator, not be
 * retried like other delivery failures.
 */
export class TwilioAuthError extends Error {
  constructor() {
    super('Twilio authentication failed — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN')
    this.name = 'TwilioAuthError'
  }
}

/**
 * Concrete ISmsProvider for Twilio.
 *
 * Translates between Twilio's REST API shape (e.g. `MessageSid`,
 * `NumSegments` as strings, status callbacks on the same webhook URL)
 * and the provider-agnostic types in sms.provider.interface.ts.
 */
export class TwilioProvider implements ISmsProvider {
  private client: ReturnType<typeof twilio>

  constructor(private readonly cfg: NonNullable<typeof config.twilio>) {
    this.client = twilio(cfg.accountSid, cfg.authToken)
  }

  async provisionNumber(params: {
    webhookUrl: string
    country:    string
    numberType: string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }> {
    const { webhookUrl, country, numberType } = params
    const available = await (this.client.availablePhoneNumbers(country) as any)[numberType].list({ limit: 1 })
    if (!available.length) throw new Error(`No available ${numberType} numbers in ${country}`)
    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      smsUrl:      webhookUrl,
      smsMethod:   'POST',
    })
    return { assignedPhone: purchased.phoneNumber, assignedPhoneSid: purchased.sid }
  }

  /**
   * Send an SMS via Twilio and return structured result data.
   *
   * @throws TwilioAuthError if Twilio returns code 20003 (bad credentials).
   * @throws SmsDeliveryError on any other Twilio API failure.
   */
  async sendSms(to: string, body: string, from: string): Promise<SmsSendResult> {
    try {
      const message = await this.client.messages.create({
        to,
        from,
        body,
        statusCallback: `${config.app.baseUrl}/webhooks/twilio`,
      })
      return {
        messageId: message.sid,
        // Twilio returns numSegments as a string; coerce to number for the
        // provider-agnostic shape. `?? '1'` guards the rare case Twilio
        // omits the field entirely.
        segments:  Number(message.numSegments ?? '1'),
        status:    message.status,
      }
    } catch (err: any) {
      if (err.code === 20003) throw new TwilioAuthError()
      throw new SmsDeliveryError(err.message ?? 'SMS delivery failed', err.code)
    }
  }

  validateWebhookSignature(req: FastifyRequest): boolean {
    try {
      const signature = (req.headers['x-twilio-signature'] as string) ?? ''
      const url       = `${config.app.baseUrl}${req.url}`
      const params    = (req.body as Record<string, string>) ?? {}
      return twilio.validateRequest(this.cfg.authToken, signature, url, params)
    } catch {
      return false
    }
  }

  /**
   * Normalize a Twilio webhook POST body into a provider-agnostic
   * {@link WebhookEvent}.
   *
   * Twilio uses the same endpoint for two distinct event kinds. We
   * discriminate on `MessageStatus`: status callbacks include it, inbound
   * messages don't. The handler then branches on `event.type` and accesses
   * only the fields that exist for that variant.
   *
   * Missing fields fall back to empty strings / zeros rather than throwing.
   * The handler runs its own malformed-payload check (and logs/drops 200
   * if required fields are absent).
   */
  parseWebhook(req: FastifyRequest): WebhookEvent {
    const body = req.body as Record<string, string>

    // Discriminator: MessageStatus is present on status callbacks and
    // absent on inbound messages. SmsStatus is a legacy duplicate Twilio
    // also emits; we check both for robustness.
    const status = body.MessageStatus || body.SmsStatus

    if (status) {
      return {
        type:         'status',
        from:         body.From          ?? '',
        to:           body.To            ?? '',
        messageId:    body.MessageSid ?? body.SmsSid ?? '',
        status,
        segments:     Number(body.NumSegments ?? '1'),
        // ErrorCode / ErrorMessage are sometimes sent as empty strings on
        // success states (e.g. `delivered`). `||` collapses both undefined
        // and '' to undefined so `errorCode != null` actually means error.
        errorCode:    body.ErrorCode    || undefined,
        errorMessage: body.ErrorMessage || undefined,
      }
    }

    return {
      type:      'inbound',
      from:      body.From          ?? '',
      to:        body.To            ?? '',
      body:      (body.Body ?? '').trim(),
      messageId: body.MessageSid ?? body.SmsSid ?? '',
      segments:  Number(body.NumSegments ?? '1'),
      numMedia:  Number(body.NumMedia    ?? '0'),
    }
  }
}
