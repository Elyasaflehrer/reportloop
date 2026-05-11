import type { FastifyRequest } from 'fastify'
import type { ISmsProvider, InboundSmsPayload } from '../sms.provider.interface.js'

// ─── Types ────────────────────────────────────────────────────────────────────

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

  async sendSms(to: string, body: string, from: string): Promise<string> {
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
    return messageId
  }

  validateWebhookSignature(_req: FastifyRequest): boolean {
    // v1: always accept. Header-driven rejection lands when a webhook-signature
    // test needs it.
    return true
  }

  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload {
    // Mock inbound webhooks are JSON, not form-encoded.
    const body = req.body as Record<string, string>
    return {
      from:      body.from,
      to:        body.to,
      body:      body.body,
      messageId: body.messageId,
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
