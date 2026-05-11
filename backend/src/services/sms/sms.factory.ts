import { config } from '../../config.js'
import type { ISmsProvider } from './sms.provider.interface.js'
import { TwilioProvider } from './providers/twilio.provider.js'
import { MockSmsProvider } from './providers/mock.provider.js'

export function createSmsProvider(): ISmsProvider {
  const provider = config.smsProvider ?? 'twilio'
  switch (provider) {
    case 'twilio':
      if (!config.twilio) throw new Error('SMS_PROVIDER=twilio but Twilio env vars are not set')
      return new TwilioProvider(config.twilio)
    case 'mock':
      if (config.node_env === 'production') {
        throw new Error('SMS_PROVIDER=mock is not allowed in production')
      }
      return new MockSmsProvider()
    // future: case 'vonage': return new VonageProvider(config.vonage!)
    default:
      throw new Error(`Unknown SMS_PROVIDER: "${provider}"`)
  }
}
