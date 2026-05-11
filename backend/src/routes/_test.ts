import type { FastifyInstance } from 'fastify'
import type { MockSmsProvider } from '../services/sms/providers/mock.provider.js'

// Test-only inspection routes. Mounted in app.ts ONLY when SMS_PROVIDER=mock,
// so this surface does not exist in production.

export async function testRoutes(
  app:  FastifyInstance,
  opts: { mockProvider: MockSmsProvider },
) {
  // GET /_test/sms-log → returns the mock's full call log (provisionNumber + sendSms)
  app.get('/_test/sms-log', async () => {
    return opts.mockProvider.getCallLog()
  })

  // DELETE /_test/sms-log → clears the call log AND resets counters; returns 204
  app.delete('/_test/sms-log', async (_req, reply) => {
    opts.mockProvider.clearCallLog()
    return reply.status(204).send()
  })
}
