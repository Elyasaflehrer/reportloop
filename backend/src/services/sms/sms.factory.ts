import { config } from '../../config.js'
import type { ISmsProvider } from './sms.provider.interface.js'
import { TwilioProvider } from './providers/twilio.provider.js'

export function createSmsProvider(): ISmsProvider {
  const provider = config.smsProvider ?? 'twilio'
  switch (provider) {
    case 'twilio':
      if (!config.twilio) throw new Error('SMS_PROVIDER=twilio but Twilio env vars are not set')
      return new TwilioProvider(config.twilio)
    // future: case 'vonage': return new VonageProvider(config.vonage!)
    default:
      throw new Error(`Unknown SMS_PROVIDER: "${provider}"`)
  }
}
