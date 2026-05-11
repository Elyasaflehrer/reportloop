// Manager phone-number provisioning — Mock-backed queue.
//
// These tests cover the scenarios that previously required real Twilio money
// (number purchases, paid SMS) and are now $0 thanks to the in-memory mock
// SMS provider. They live in their own file (separate from users.test.ts)
// for three reasons:
//
//   1. Distinct setup. Every test in this file calls `clearSmsLog()` in
//      beforeEach in addition to `truncateAll()`. The mock log is a
//      process-global in the backend, so a previous test's entries leak
//      across cases unless cleared. users.test.ts doesn't need that.
//
//   2. Distinct precondition. The whole file requires the backend to be
//      running with SMS_PROVIDER=mock. If the backend isn't on the mock,
//      every test here would 404 on /_test/sms-log. Keeping them isolated
//      makes the failure mode obvious (whole file red, not a confusing
//      sprinkle across user-CRUD).
//
//   3. Distinct assertion pattern. Provisioning is fire-and-forget
//      (`void onManagerCreated(...)` in routes/users.ts), so these tests
//      poll the mock log with `waitForSmsCall(...)` before reading DB
//      state. That's a different rhythm from synchronous-response tests.
//
// As the Mock-backed queue (see tests/backend-test-plan.md) is worked
// through, the related Cat 1, Cat 2, and Cat 3 manager/provisioning
// scenarios land here. Schedule, broadcast, and inbound-webhook
// mock-backed scenarios get their own files when we reach them.

import { beforeEach, describe, it, expect } from 'vitest'
import { del, patch, post } from '../helpers/api'
import { prisma, truncateAll } from '../helpers/db'
import { seedAdmin, seedUser, type SeededUser } from '../helpers/factories'
import { clearSmsLog, getSmsLog, waitForSmsCall } from '../helpers/mock-sms'

describe('Manager provisioning — POST /users with role=manager', () => {
  let admin: SeededUser

  beforeEach(async () => {
    await truncateAll()
    await clearSmsLog()
    admin = await seedAdmin({ email: 'admin@test.local' })
  })

  it('1.2 — admin creates a manager → provisioning fires, mock logs the call, manager row gets assignedPhone + sid', async () => {
    const res = await post('/users', admin.token, {
      name:  'Mary',
      email: 'mary@test.local',
      role:  'manager',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name:  'Mary',
      email: 'mary@test.local',
      role:  'manager',
    })

    // Wait for the mock to record the provisionNumber call — provisioning
    // is fired async from the route handler (`void onManagerCreated(...)`),
    // so the 201 above returns BEFORE the provider call lands.
    const call = await waitForSmsCall((c) => c.kind === 'provisionNumber')
    if (call.kind !== 'provisionNumber') throw new Error('unreachable')

    // Mock-side assertions: synthetic but well-formed values
    expect(call.assignedPhone).toMatch(/^\+1555000\d{4}$/)
    expect(call.assignedPhoneSid).toMatch(/^MOCKPN\d{4}$/)

    // DB-side assertion: the same number landed on the manager's row.
    // Poll briefly because the DB write happens just after the log entry —
    // both are inside onManagerCreated but the log push runs first.
    let inDb = await prisma.user.findFirst({ where: { email: 'mary@test.local' } })
    for (let i = 0; i < 20 && inDb?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      inDb = await prisma.user.findFirst({ where: { email: 'mary@test.local' } })
    }
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('manager')
    expect(inDb?.assignedPhone).toBe(call.assignedPhone)
    expect(inDb?.assignedPhoneSid).toBe(call.assignedPhoneSid)
  })

  it('3.5 — manual provision when at PHONE_MAX_NUMBERS → 409 PHONE_LIMIT_REACHED', async () => {
    try {
      // Default maxNumbers is 2 (config.ts:37). Fill both slots first.
      const m1 = await post('/users', admin.token, { name: 'M1', email: 'm1@test.local', role: 'manager' })
      expect(m1.status).toBe(201)
      await waitForSmsCall((c) => c.kind === 'provisionNumber' && c.assignedPhone === '+15550000001')

      const m2 = await post('/users', admin.token, { name: 'M2', email: 'm2@test.local', role: 'manager' })
      expect(m2.status).toBe(201)
      await waitForSmsCall((c) => c.kind === 'provisionNumber' && c.assignedPhone === '+15550000002')

      // Seed a third manager DIRECTLY (bypasses eager provisioning). This isn't
      // testing the create path — it's testing the manual provision endpoint —
      // so we sidestep the fire-and-forget eager attempt to keep the log state
      // deterministic for the assertion below.
      const m3 = await seedUser({ role: 'manager', email: 'm3@test.local' })

      // Manual provision runs synchronously, surfaces ProvisionLimitError as 409
      const manual = await post(`/users/${m3.user.id}/provision-number`, admin.token)
      expect(manual.status).toBe(409)
      expect(manual.body).toMatchObject({
        error: {
          code:    'PHONE_LIMIT_REACHED',
          message: 'Phone number provisioning limit reached',
        },
      })

      // The provider was NOT called — purchaseNewNumber throws before
      // smsProvider.provisionNumber() runs. Log still has only the original two.
      const log = await getSmsLog()
      expect(log.filter((c) => c.kind === 'provisionNumber')).toHaveLength(2)

      // DB: m3 still has no phone
      const inDb = await prisma.user.findFirst({ where: { email: 'm3@test.local' } })
      expect(inDb?.assignedPhone).toBeNull()
      expect(inDb?.assignedPhoneSid).toBeNull()
    } catch (err) {
      throw new Error(
        '\n\n' +
        '################################################################\n' +
        '##                                                            ##\n' +
        '##   [3.5] TEST FAILED — CONFIG REQUIRED                      ##\n' +
        '##                                                            ##\n' +
        '##   Set the env variable  PHONE_MAX_NUMBERS=2                ##\n' +
        '##   Why: test fills 2 slots, then expects the 3rd to 409.    ##\n' +
        '##   Restart the backend after editing, then re-run.          ##\n' +
        '##                                                            ##\n' +
        '################################################################\n\n' +
        `Original error: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  })

  it('1.23 — soft-delete a manager → assignedPhone stays on the row', async () => {
    // Setup: create a manager and wait for eager provisioning to land both
    // the log entry and the DB write (assignedPhone + sid).
    const create = await post('/users', admin.token, {
      name:  'Soft',
      email: 'soft@test.local',
      role:  'manager',
    })
    expect(create.status).toBe(201)
    await waitForSmsCall((c) => c.kind === 'provisionNumber')

    let before = await prisma.user.findFirst({ where: { email: 'soft@test.local' } })
    for (let i = 0; i < 20 && before?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      before = await prisma.user.findFirst({ where: { email: 'soft@test.local' } })
    }
    expect(before).not.toBeNull()
    expect(before?.assignedPhone).not.toBeNull()
    expect(before?.assignedPhoneSid).not.toBeNull()

    // Act: admin soft-deletes the manager
    const resDel = await del(`/users/${before!.id}`, admin.token)
    expect(resDel.status).toBe(204)

    // Two-part assertion:
    //   Part 1 — soft-delete flags were set (active=false, deletedAt set).
    //   Part 2 — assignedPhone + sid are UNCHANGED. The number stays on the
    //   deleted row so phone-number.service.ts:recycleIdleNumber can later
    //   reclaim it for a new manager (source filter: assignedPhone not null,
    //   role != manager — soft-deleted managers still match because their
    //   role doesn't change on delete).
    const after = await prisma.user.findUnique({ where: { id: before!.id } })
    expect(after).not.toBeNull()
    expect(after?.active).toBe(false)
    expect(after?.deletedAt).not.toBeNull()
    expect(after?.assignedPhone).toBe(before!.assignedPhone)
    expect(after?.assignedPhoneSid).toBe(before!.assignedPhoneSid)
  })

  it('2.1 — viewer promoted to manager via PATCH → provisioning fires, row gets a number', async () => {
    // Setup: seed a viewer directly. Viewer creation is NOT the SUT; we just
    // need a non-manager row with no assignedPhone to promote.
    const viewer = await seedUser({ role: 'viewer', email: 'viewer@test.local' })
    expect(viewer.user.assignedPhone).toBeNull()

    // Act: admin promotes viewer → manager
    const res = await patch(`/users/${viewer.user.id}`, admin.token, { role: 'manager' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ role: 'manager' })

    // Provisioning fires async from users.ts:292 (void onManagerCreated(...)).
    // Same pattern as create-as-manager — poll the mock log first, then the DB.
    const call = await waitForSmsCall((c) => c.kind === 'provisionNumber')
    if (call.kind !== 'provisionNumber') throw new Error('unreachable')
    expect(call.assignedPhone).toMatch(/^\+1555000\d{4}$/)
    expect(call.assignedPhoneSid).toMatch(/^MOCKPN\d{4}$/)

    // DB: poll until the promoted user's row picks up the phone fields.
    let inDb = await prisma.user.findUnique({ where: { id: viewer.user.id } })
    for (let i = 0; i < 20 && inDb?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      inDb = await prisma.user.findUnique({ where: { id: viewer.user.id } })
    }
    expect(inDb?.role).toBe('manager')
    expect(inDb?.assignedPhone).toBe(call.assignedPhone)
    expect(inDb?.assignedPhoneSid).toBe(call.assignedPhoneSid)
  })

  it('2.5 — demote then re-promote → reclaims own number, no provider call', async () => {
    // 1. Create a manager and wait for eager provisioning to land the phone.
    const create = await post('/users', admin.token, {
      name:  'Re',
      email: 're@test.local',
      role:  'manager',
    })
    expect(create.status).toBe(201)
    await waitForSmsCall((c) => c.kind === 'provisionNumber')

    let mgr = await prisma.user.findFirst({ where: { email: 're@test.local' } })
    for (let i = 0; i < 20 && mgr?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      mgr = await prisma.user.findFirst({ where: { email: 're@test.local' } })
    }
    const originalPhone = mgr!.assignedPhone!
    const originalSid   = mgr!.assignedPhoneSid!
    expect(originalPhone).not.toBeNull()

    // 2. Snapshot the mock log — exactly one provisionNumber entry so far.
    const beforeLog = await getSmsLog()
    expect(beforeLog.filter((c) => c.kind === 'provisionNumber')).toHaveLength(1)

    // 3. Demote: PATCH role='viewer'. Asserts that demotion preserves the
    //    phone fields — this is the precondition for Step 1 (reuseOwnNumber).
    const demote = await patch(`/users/${mgr!.id}`, admin.token, { role: 'viewer' })
    expect(demote.status).toBe(200)
    expect(demote.body).toMatchObject({ role: 'viewer' })

    const demoted = await prisma.user.findUnique({ where: { id: mgr!.id } })
    expect(demoted?.role).toBe('viewer')
    expect(demoted?.assignedPhone).toBe(originalPhone)
    expect(demoted?.assignedPhoneSid).toBe(originalSid)

    // 4. Re-promote: PATCH role='manager'. onManagerCreated fires async; its
    //    Step 1 (reuseOwnNumber) sees the existing phone and short-circuits.
    const repromote = await patch(`/users/${mgr!.id}`, admin.token, { role: 'manager' })
    expect(repromote.status).toBe(200)
    expect(repromote.body).toMatchObject({ role: 'manager' })

    // 5. Wait for the async onManagerCreated to finish. We can't poll for
    //    "nothing happened" — fixed delay is the pragmatic choice. If a bug
    //    ever makes the re-promote hit the provider, the log check below
    //    catches it.
    await new Promise((r) => setTimeout(r, 500))

    // 6. Critical assertion — log still has exactly one provisionNumber
    //    entry. Proves Step 1 short-circuited; no new number was bought.
    const afterLog = await getSmsLog()
    expect(afterLog.filter((c) => c.kind === 'provisionNumber')).toHaveLength(1)

    // 7. DB sanity — phone fields unchanged.
    const repromoted = await prisma.user.findUnique({ where: { id: mgr!.id } })
    expect(repromoted?.role).toBe('manager')
    expect(repromoted?.assignedPhone).toBe(originalPhone)
    expect(repromoted?.assignedPhoneSid).toBe(originalSid)
  })

  it('3.3 — new manager recycles an idle number (no provider call)', async () => {
    // Tests Step 2 of the provisioning chain — recycleIdleNumber.
    // Setup an "idle" number by creating M1 and demoting them to viewer.
    // A fresh M2 should inherit M1's phone instead of buying a new one.
    //
    // Expected outcome for M2:
    //   reuseOwnNumber(M2)    → null (M2 has no phone yet)
    //   recycleIdleNumber(M2) → finds M1 (assignedPhone set, role='viewer'
    //                          after demotion, id != M2). Transactionally
    //                          transfers the phone: M2 gains it, M1 loses it.
    //   purchaseNewNumber     → not reached.

    // 1. Create M1, wait for eager provisioning to land the phone.
    const m1Create = await post('/users', admin.token, {
      name:  'M1Idle',
      email: 'm1idle@test.local',
      role:  'manager',
    })
    expect(m1Create.status).toBe(201)
    await waitForSmsCall((c) => c.kind === 'provisionNumber')

    let m1 = await prisma.user.findFirst({ where: { email: 'm1idle@test.local' } })
    for (let i = 0; i < 20 && m1?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      m1 = await prisma.user.findFirst({ where: { email: 'm1idle@test.local' } })
    }
    const m1OriginalPhone = m1!.assignedPhone!
    const m1OriginalSid   = m1!.assignedPhoneSid!

    // 2. Demote M1 → viewer. Phone stays on the row, now matches the
    //    recycleIdleNumber filter (assignedPhone not null, role != manager).
    const demote = await patch(`/users/${m1!.id}`, admin.token, { role: 'viewer' })
    expect(demote.status).toBe(200)
    const m1Demoted = await prisma.user.findUnique({ where: { id: m1!.id } })
    expect(m1Demoted?.role).toBe('viewer')
    expect(m1Demoted?.assignedPhone).toBe(m1OriginalPhone)

    // 3. Snapshot — exactly one provisionNumber entry from M1's creation.
    const beforeLog = await getSmsLog()
    expect(beforeLog.filter((c) => c.kind === 'provisionNumber')).toHaveLength(1)

    // 4. Create M2 — eager provisioning runs the chain, should recycle M1's phone.
    const m2Create = await post('/users', admin.token, {
      name:  'M2Recycle',
      email: 'm2recycle@test.local',
      role:  'manager',
    })
    expect(m2Create.status).toBe(201)

    // 5. Poll M2's row — recycle is internal, no log entry to wait on.
    let m2 = await prisma.user.findFirst({ where: { email: 'm2recycle@test.local' } })
    for (let i = 0; i < 40 && m2?.assignedPhone == null; i++) {
      await new Promise((r) => setTimeout(r, 50))
      m2 = await prisma.user.findFirst({ where: { email: 'm2recycle@test.local' } })
    }

    // 6. Critical assertion — M2 inherited M1's exact phone + sid.
    //    Bug case: if purchaseNewNumber ran instead, M2 would have +15550000002
    //    and the log below would have 2 entries.
    expect(m2?.assignedPhone).toBe(m1OriginalPhone)
    expect(m2?.assignedPhoneSid).toBe(m1OriginalSid)

    // 7. The transfer is two-sided — M1 (the viewer) no longer holds the phone.
    const m1AfterRecycle = await prisma.user.findUnique({ where: { id: m1!.id } })
    expect(m1AfterRecycle?.assignedPhone).toBeNull()
    expect(m1AfterRecycle?.assignedPhoneSid).toBeNull()

    // 8. Mock log unchanged — provider was NOT called for M2.
    const afterLog = await getSmsLog()
    expect(afterLog.filter((c) => c.kind === 'provisionNumber')).toHaveLength(1)
  })
})
