// User CRUD tests against POST /users.
//
// Each test wipes the DB, seeds a single admin (so we have someone to
// authenticate as), then exercises the API and asserts on the response
// + the resulting DB row.

import { beforeEach, describe, it, expect } from 'vitest'
import { del, get, patch, post } from '../helpers/api'
import { prisma, truncateAll } from '../helpers/db'
import { seedAdmin, seedUser ,type SeededUser } from '../helpers/factories'

describe('User CRUD — POST /users', () => {
  let admin: SeededUser
  let viewerRole: SeededUser
  let managerRole: SeededUser
  let participantRole: SeededUser

  beforeEach(async () => {
    await truncateAll()
    admin = await seedAdmin({ email: 'admin@test.local' })
    managerRole = await seedUser({ role: 'manager', email: 'manager@test.local' })
    viewerRole = await seedUser({ role: 'viewer', email: 'viewer@test.local' })
    participantRole = await seedUser({ role: 'participant', email: 'participant@test.local' })
  })

  it('1.3a — admin creates a viewer user', async () => {
    const res = await post('/users', admin.token, {
      name: 'Alice',
      email: 'alice@test.local',
      role: 'viewer',
    })
    // Response shape
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: 'Alice',
      email: 'alice@test.local',
      role: 'viewer',
    })

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { email: 'alice@test.local' },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('viewer')
    expect(inDb?.deletedAt).toBeNull()
  })

  // for user phone it's not required field unlike participant
  it('1.3b admin creates a viewer user without phone)', async () => {
    const res = await post('/users', admin.token, {
      name: "AliceWithoutPhone",
      email: 'asliceWithoutPhone@test.local',
      // role=viewer but no phone — allowed
      role: 'viewer',
    })
    expect(res.status).toBe(201)
    const inDb = await prisma.user.findFirst({
      where: { email: 'asliceWithoutPhone@test.local' },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('viewer')
    expect(inDb?.phone).toBeNull()
    expect(inDb?.deletedAt).toBeNull()
  })

  it('1.4 — admin creates a participant user (phone only, no email)', async () => {
    const res = await post('/users', admin.token, {
      name: 'Pat',
      phone: '+15555550100',
      role: 'participant',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: 'Pat',
      phone: '+15555550100',
      role: 'participant',
      email: null,
    })

    const inDb = await prisma.user.findFirst({
      where: { phone: '+15555550100' },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('participant')
    expect(inDb?.email).toBeNull()
    // Participants skip the Supabase invite path → supabaseId stays null
    expect(inDb?.supabaseId).toBeNull()
    expect(inDb?.deletedAt).toBeNull()
  })

  it('1.5a Create with name required field)', async () => {
    const res = await post('/users', admin.token, {
      // missing `name` — required by createUserBody schema (z.string().min(1))
      phone: '+15555550100',
      role: 'participant',
    })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: {
        fieldErrors: {
          name: expect.any(Array),
        },
      },
    })
    const inDb = await prisma.user.findFirst({
      where: { phone: '+15555550100' },
    })
    expect(inDb).toBeNull()
  })

  it('1.5b Create with phone required field)', async () => {
    const res = await post('/users', admin.token, {
      name: "PatMissingPhone",
      // role=participant but no phone — Zod passes, route-level guard rejects
      role: 'participant',
    })
    expect(res.status).toBe(400)
    const inDb = await prisma.user.findFirst({
      where: { name: 'PatMissingPhone' },
    })
    expect(inDb).toBeNull()
  })

  it('1.6 Create with duplicate email)', async () => {
    const res1 = await post('/users', admin.token, {
      name: 'AliceDuplicatEmail1',
      email: 'alice@test.local',
      role: 'viewer',
    })
    const res2 = await post('/users', admin.token, {
      name: 'AliceDuplicatEmail2',
      email: 'alice@test.local',
      role: 'viewer',
    })
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(409)
    const inDb = await prisma.user.findFirst({
      where: { name: 'AliceDuplicatEmail2' },
    })
    expect(inDb).toBeNull()
  })

  it('1.7 Create with duplicate phone)', async () => {
    const res1 = await post('/users', admin.token, {
      name: "PatDuplicatePhone1",
      phone: '+15555550100',
      role: 'participant',
    })
    const res2 = await post('/users', admin.token, {
      name: "PatDuplicatePhone2",
      phone: '+15555550100',
      role: 'participant',
    })

    expect(res1.status).toBe(201)
    expect(res2.status).toBe(409)

    const inDb = await prisma.user.findFirst({
      where: { name: 'PatDuplicatePhone2' },
    })
    expect(inDb).toBeNull()
  })

  it('1.8a — Create with malformed email role viewer', async () => {
    const res = await post('/users', admin.token, {
      name: 'AliceMalformedEmailViewer',
      email: 'alice',
      role: 'viewer',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: 'AliceMalformedEmailViewer' },
    })
    expect(inDb).toBeNull()
  })

  it('1.8b — Create with malformed email role participant', async () => {
    const res = await post('/users', admin.token, {
      name: 'AliceMalformedEmailparticipant',
      email: 'aliceParticipant',
      role: 'participant',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: 'AliceMalformedEmailparticipant' },
    })
    expect(inDb).toBeNull()
  })

  it('1.9b — Create with malformed phone (non-E.164) role viewer', async () => {
    const res = await post('/users', admin.token, {
      name: 'AliceMalformedphoneViewer',
      email: 'alice@test',
      phone: '050-123-4567',
      role: 'viewer',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: 'AliceMalformedphoneViewer' },
    })
    expect(inDb).toBeNull()
  })

  it('1.9b — Create with malformed phone (non-E.164) role participant', async () => {
    const res = await post('/users', admin.token, {
      name: 'AliceMalformedphoneParticipant',
      email: 'alice@test',
      phone: '050-123-4563',
      role: 'participant',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: 'AliceMalformedphoneParticipant' },
    })
    expect(inDb).toBeNull()
  })

  it('1.10a — non-admin viewer caller → 403', async () => {
    // Use VIEWER's token (not admin's)
    const res = await post('/users', viewerRole.token, {
      name:  'BobViewerToken',
      email: 'bobViewerToken@test.local',
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: 'bobViewerToken@test.local' },
    })
    expect(inDb).toBeNull()
  })

  it('1.10b — non-admin manager caller → 403', async () => {
    // Use MANAGER's token (not admin's)
    const res = await post('/users', managerRole.token, {
      name:  'BobManagerToken',
      email: 'bobManagerToken@test.local',
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: 'bobManagerToken@test.local' },
    })
    expect(inDb).toBeNull()
  })

  it('1.10c — non-admin participant caller → 403', async () => {
    // Use MANAGER's token (not admin's)
    const res = await post('/users', participantRole.token, {
      name:  'BobParticipantToken',
      email: 'bobParticipantToken@test.local',
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: 'bobParticipantToken@test.local' },
    })
    expect(inDb).toBeNull()
  })

  it('1.21 — soft-delete user (DELETE /users/:id)', async () => {
    // Setup: a viewer with their own token (so we can test login-after-delete)
    const target = await seedUser({ role: 'viewer', email: 'AliceSoftDelete@test.local' })

    // Sanity: viewer's token works BEFORE delete
    const beforeRes = await get('/auth/me', target.token)
    expect(beforeRes.status).toBe(200)

    // Act: admin soft-deletes the viewer
    const resDel = await del(`/users/${target.user.id}`, admin.token)
    expect(resDel.status).toBe(204)

    // Part 1 — users table: active=false, deletedAt set
    const inDb = await prisma.user.findUnique({
      where: { id: target.user.id },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.active).toBe(false)
    expect(inDb?.deletedAt).not.toBeNull()

    // Part 2 — authentication: viewer's old token is now rejected
    // (rbac.ts:42 filters by active:true AND deletedAt:null → 401)
    const afterRes = await get('/auth/me', target.token)
    expect(afterRes.status).toBe(401)
  })

})
