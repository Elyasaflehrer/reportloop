import twilio from 'twilio'
import type { FastifyRequest } from 'fastify'
import type { ISmsProvider, InboundSmsPayload } from '../sms.provider.interface.js'
import { config } from '../../../config.js'

export class SmsDeliveryError extends Error {
  constructor(message: string, public readonly code?: string | number) {
    super(message)
    this.name = 'SmsDeliveryError'
  }
}

export class TwilioAuthError extends Error {
  constructor() {
    super('Twilio authentication failed — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN')
    this.name = 'TwilioAuthError'
  }
}

export class TwilioProvider implements ISmsProvider {
  private client: ReturnType<typeof twilio>

  constructor(private readonly cfg: NonNullable<typeof config.twilio>) {
    this.client = twilio(cfg.accountSid, cfg.authToken)
  }

  async sendSms(to: string, body: string): Promise<string> {
    try {
      const message = await this.client.messages.create({
        to,
        from:           this.cfg.fromNumber,
        body,
        statusCallback: `${config.app.baseUrl}/webhooks/twilio/status`,
      })
      return message.sid
    } catch (err: any) {
      // Twilio error code 20003 = authentication failure
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

  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload {
    const body = req.body as Record<string, string>
    return {
      from:      body.From,
      body:      body.Body,
      messageId: body.MessageSid,
    }
  }
}
