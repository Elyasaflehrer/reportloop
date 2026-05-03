/**
 * Integration tests for provisionForManager() and onManagerCreated().
 *
 * Tests all 5 provisioning paths against the real database:
 *   1. Reuse own number    — returns existing assignedPhone, no Twilio call
 *   2. Recycle idle number — transfers from non-manager user, no Twilio call
 *   3. Purchase new number — buys from Twilio (real API call, auto-released after)
 *   4. Limit guard         — throws ProvisionLimitError when at maxNumbers
 *   5. Failure safety      — onManagerCreated never throws, even when Twilio fails
 *
 * Test users are created with a timestamp prefix and deleted in cleanup.
 * Any Twilio numbers purchased in Path 3 are released automatically.
 *
 * Run via VS Code: Run & Debug → "Test: Provision Service"
 */
import 'dotenv/config'
import twilio from 'twilio'
import { config } from '../../src/config.ts'
import { prisma } from '../../src/db.ts'
import { TwilioProvider } from '../../src/services/sms/providers/twilio.provider.ts'
import { provisionForManager, type PhoneProvisionSettings } from '../../src/services/sms/phone-number.service.ts'
import { onManagerCreated } from '../../src/services/manager.service.ts'
import { ProvisionLimitError } from '../../src/services/sms/phone-number.errors.ts'
import type { ISmsProvider } from '../../src/services/sms/sms.provider.interface.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Provider that throws if provisionNumber is ever called — used for paths 1 & 2
const neverProvision: ISmsProvider = {
  sendSms:                   async () => { throw new Error('sendSms should not be called') },
  validateWebhookSignature:  ()      => true,
  parseInboundWebhook:       ()      => { throw new Error('parseInboundWebhook should not be called') },
  provisionNumber:           async () => { throw new Error('provisionNumber was called but should not have been') },
}

const phoneSettings: PhoneProvisionSettings = {
  maxNumbers:    config.phone.maxNumbers,
  numberCountry: config.phone.numberCountry,
  numberType:    config.phone.numberType,
  webhookBaseUrl: config.app.baseUrl,
}

const TEST_PREFIX = `[test-${Date.now()}]`

// ─── Setup & teardown ─────────────────────────────────────────────────────────

let testUserIds: number[] = []
let twilioSidsToRelease: string[] = []

async function createUser(overrides: {
  role:          'manager' | 'participant'
  assignedPhone?: string
  assignedPhoneSid?: string
}) {
  const user = await prisma.user.create({
    data: {
      name:            `${TEST_PREFIX} user`,
      role:            overrides.role,
      assignedPhone:   overrides.assignedPhone ?? null,
      assignedPhoneSid: overrides.assignedPhoneSid ?? null,
    },
  })
  testUserIds.push(user.id)
  return user
}

async function cleanup() {
  // Release any real Twilio numbers bought during tests
  if (twilioSidsToRelease.length && config.twilio) {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken)
    for (const sid of twilioSidsToRelease) {
      try {
        await client.incomingPhoneNumbers(sid).remove()
        console.log(`  Cleanup: released Twilio number ${sid}`)
      } catch {
        console.warn(`  Cleanup WARNING: could not release ${sid} — remove manually in Twilio console`)
      }
    }
  }

  // Delete test users
  if (testUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } })
  }

  await prisma.$disconnect()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nprovisionForManager()\n')

  // ── Path 1: reuse own number ────────────────────────────────────────────────
  await test('returns existing number immediately without calling Twilio', async () => {
    const user = await createUser({ role: 'manager', assignedPhone: '+15550000001', assignedPhoneSid: 'PNtest001' })

    const phone = await provisionForManager(user.id, { prisma, smsProvider: neverProvision, phoneSettings })

    assert(phone === '+15550000001', `Expected "+15550000001", got "${phone}"`)

    // Verify DB unchanged
    const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { assignedPhone: true } })
    assert(fresh?.assignedPhone === '+15550000001', 'DB assignedPhone should not have changed')
  })

  // ── Path 2: recycle idle number ─────────────────────────────────────────────
  await test('transfers idle number from non-manager without calling Twilio', async () => {
    const source  = await createUser({ role: 'participant', assignedPhone: '+15550000002', assignedPhoneSid: 'PNtest002' })
    const manager = await createUser({ role: 'manager' })

    const phone = await provisionForManager(manager.id, { prisma, smsProvider: neverProvision, phoneSettings })

    assert(phone === '+15550000002', `Expected "+15550000002", got "${phone}"`)

    const updatedManager = await prisma.user.findUnique({ where: { id: manager.id }, select: { assignedPhone: true } })
    const updatedSource  = await prisma.user.findUnique({ where: { id: source.id },  select: { assignedPhone: true } })

    assert(updatedManager?.assignedPhone === '+15550000002', 'Manager should have the recycled number')
    assert(updatedSource?.assignedPhone  === null,           'Source user should have no number after transfer')
  })

  // ── Path 3: purchase new number ─────────────────────────────────────────────
  await test('purchases a new number from Twilio when no idle numbers exist', async () => {
    if (!config.twilio) throw new Error('Twilio not configured — skipping purchase test')

    const manager  = await createUser({ role: 'manager' })
    const provider = new TwilioProvider(config.twilio)

    const phone = await provisionForManager(manager.id, { prisma, smsProvider: provider, phoneSettings })

    assert(phone.startsWith('+'), `Expected E.164 format, got "${phone}"`)

    const fresh = await prisma.user.findUnique({ where: { id: manager.id }, select: { assignedPhone: true, assignedPhoneSid: true } })
    assert(fresh?.assignedPhone   === phone, 'DB assignedPhone should match returned value')
    assert(!!fresh?.assignedPhoneSid,        'DB assignedPhoneSid should be set')

    // Queue the purchased number for release in cleanup
    if (fresh?.assignedPhoneSid) twilioSidsToRelease.push(fresh.assignedPhoneSid)
  })

  // ── Path 4: limit guard ─────────────────────────────────────────────────────
  await test('throws ProvisionLimitError when at maxNumbers limit', async () => {
    const manager = await createUser({ role: 'manager' })

    try {
      await provisionForManager(manager.id, {
        prisma,
        smsProvider:   neverProvision,
        phoneSettings: { ...phoneSettings, maxNumbers: 0 },
      })
      throw new Error('Expected ProvisionLimitError but resolved successfully')
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Expected')) throw err
      if (!(err instanceof ProvisionLimitError))
        throw new Error(`Expected ProvisionLimitError, got: ${err}`)
      assert(err.code === 'PHONE_LIMIT_REACHED', `Expected code PHONE_LIMIT_REACHED, got: "${err.code}"`)
    }
  })

  // ── Path 5: onManagerCreated never throws ───────────────────────────────────
  await test('onManagerCreated does not throw when provisioning fails', async () => {
    const manager = await createUser({ role: 'manager' })

    const alwaysFails: ISmsProvider = {
      ...neverProvision,
      provisionNumber: async () => { throw new Error('Twilio is down') },
    }

    // Should resolve without throwing — manager creation must not be blocked
    await onManagerCreated(manager.id, { prisma, smsProvider: alwaysFails, phoneSettings })
  })

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch(console.error)
  .finally(cleanup)
