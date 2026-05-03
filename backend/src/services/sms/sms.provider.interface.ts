import type { FastifyRequest } from 'fastify'

export interface ISmsProvider {
  sendSms(to: string, body: string, from: string): Promise<string>
  provisionNumber(params: {
    webhookUrl:  string
    country:     string
    numberType:  string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }>
  validateWebhookSignature(req: FastifyRequest): boolean
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload
}

export type InboundSmsPayload = {
  from:      string  // participant's phone (From)
  to:        string  // manager's number (To)
  body:      string
  messageId: string
}
