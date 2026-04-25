import type { FastifyRequest } from 'fastify'

export interface ISmsProvider {
  sendSms(to: string, body: string): Promise<string>
  validateWebhookSignature(req: FastifyRequest): boolean
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload
}

export type InboundSmsPayload = {
  from:      string  // E.164 phone number e.g. +15551234567
  body:      string  // raw message text from participant
  messageId: string  // provider's unique message ID (idempotency key)
}
