import 'dotenv/config'
import twilio from 'twilio'
import { config } from '../../src/config.ts'
import { TwilioProvider } from '../../src/services/sms/providers/twilio.provider.ts'

if (!config.twilio) {
  console.error('Twilio not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env')
  process.exit(1)
}

const provider = new TwilioProvider(config.twilio)
const client   = twilio(config.twilio.accountSid, config.twilio.authToken)
const webhookUrl = `${config.app.baseUrl}/webhooks/twilio`

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err instanceof Error ? err.message : err}`)
    failed++
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  let assignedPhoneSid: string | null = null

  console.log('\nprovisionNumber()\n')

  // ── Happy path ──────────────────────────────────────────────────────────────

  let result: { assignedPhone: string; assignedPhoneSid: string } | null = null

  await test('provisions a number and returns correct shape', async () => {
    result = await provider.provisionNumber({
      webhookUrl,
      country:    config.phone.numberCountry,
      numberType: config.phone.numberType,
    })
    assignedPhoneSid = result.assignedPhoneSid

    assert(
      result.assignedPhone.startsWith('+'),
      `Expected E.164 format (starts with +), got: "${result.assignedPhone}"`,
    )
    assert(
      result.assignedPhoneSid.startsWith('PN'),
      `Expected SID to start with "PN", got: "${result.assignedPhoneSid}"`,
    )
  })

  await test('webhook URL is configured on the number in Twilio', async () => {
    if (!assignedPhoneSid) throw new Error('No SID — previous test failed')
    const number = await client.incomingPhoneNumbers(assignedPhoneSid).fetch()
    assert(
      number.smsUrl === webhookUrl,
      `Webhook URL mismatch.\n    Expected: ${webhookUrl}\n    Got:      ${number.smsUrl}`,
    )
    assert(
      number.smsMethod === 'POST',
      `Expected smsMethod POST, got: "${number.smsMethod}"`,
    )
  })

  // ── Error paths ─────────────────────────────────────────────────────────────

  await test('throws when country code is invalid', async () => {
    try {
      await provider.provisionNumber({ webhookUrl, country: 'ZZ', numberType: 'local' })
      throw new Error('Expected an error but provisionNumber resolved successfully')
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Expected an error'))
        throw err
      // Any Twilio or "No available" error = pass
    }
  })

  // ─── Summary + Cleanup ────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed\n`)

  if (assignedPhoneSid) {
    try {
      await client.incomingPhoneNumbers(assignedPhoneSid).remove()
      console.log('Cleanup: number released.')
    } catch {
      console.warn(`Cleanup WARNING: failed to release ${assignedPhoneSid} — remove manually in Twilio console.`)
    }
  }

  if (failed > 0) process.exitCode = 1
}

main().catch(console.error)
