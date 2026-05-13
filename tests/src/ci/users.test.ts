// User CRUD tests against POST /users.
//
// Each test wipes the DB, seeds a single admin (so we have someone to
// authenticate as), then exercises the API and asserts on the response
// + the resulting DB row.

import { beforeEach,afterAll, describe, it, expect } from 'vitest'
import { del, get, patch, post } from '../helpers/api'
import { prisma, truncateAllByPrefix, truncateAll } from '../helpers/db'
import { seedAdmin, seedUser ,type SeededUser } from '../helpers/factories'

describe('User CRUD — POST /users', () => {
  let admin: SeededUser
  let viewerRole: SeededUser
  let managerRole: SeededUser
  let participantRole: SeededUser

  // at top of each test file
  const TABLES_TO_TRUNCATE = [
  'users',
  ]
  const PREFIX_EMAIL = 'us.'
  const PREFIX_NAME = 'us.'
  const n = (n: string) =>  `${PREFIX_NAME}${n}`
  const e = (h: string) => `${PREFIX_EMAIL}${h}@test.local`

  beforeEach(async () => {
    await truncateAllByPrefix(PREFIX_EMAIL, TABLES_TO_TRUNCATE)
    admin = await seedAdmin({ email: e('admin') })
    managerRole = await seedUser({ role: 'manager', email: e('manager') })
    viewerRole = await seedUser({ role: 'viewer', email: e('viewer') })
    participantRole = await seedUser({ role: 'participant', email: e('participant') })
  })
  afterAll( async() =>{
     await truncateAllByPrefix(PREFIX_EMAIL, TABLES_TO_TRUNCATE)
  })

  // beforeEach(async () => {
  //   await truncateAll()
  //   admin = await seedAdmin({ email: 'users.admin@test.local' })
  //   managerRole = await seedUser({ role: 'manager', email: 'users.manager@test.local' })
  //   viewerRole = await seedUser({ role: 'viewer', email: 'users.viewer@test.local' })
  //   participantRole = await seedUser({ role: 'participant', email: 'users.participant@test.local' })
  // })

  it('1.3a — admin creates a viewer user', async () => {
    const name = n("adminCreatesViewer")
    const email = e(name.toLowerCase())
    const res = await post('/users', admin.token, {
      name: name,
      email: email,
      role: 'viewer',
    })
    // Response shape
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: name,
      email: email,
      role: 'viewer',
    })

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { email: email },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('viewer')
    expect(inDb?.deletedAt).toBeNull()
  })

  // for user phone it's not required field unlike participant
  it('1.3b admin creates a viewer user without phone)', async () => {
    const name = n("adminCreatesViewerWithoutPhone")
    const email = e(name.toLowerCase())

    const res = await post('/users', admin.token, {
      name: name,
      email: email,
      // role=viewer but no phone — allowed
      role: 'viewer',
    })
    expect(res.status).toBe(201)
    const inDb = await prisma.user.findFirst({
      where: { email: email },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('viewer')
    expect(inDb?.phone).toBeNull()
    expect(inDb?.deletedAt).toBeNull()
  })

  it('1.4 — admin creates a participant user (phone only, no email)', async () => {
    const name  = n("AdminCreatesParticipant")
    const phone = "+15551000104"
    const res = await post('/users', admin.token, {
      name:  name,
      phone: phone,
      role:  'participant',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name:  name,
      phone: phone,
      role:  'participant',
      email: null,
    })

    const inDb = await prisma.user.findFirst({
      where: { phone: phone },
    })
    expect(inDb).not.toBeNull()
    expect(inDb?.role).toBe('participant')
    expect(inDb?.email).toBeNull()
    // Participants skip the Supabase invite path → supabaseId stays null
    expect(inDb?.supabaseId).toBeNull()
    expect(inDb?.deletedAt).toBeNull()
  })

  it('1.5a Create with name required field)', async () => {
    const phone = "+15551000150"
    const res = await post('/users', admin.token, {
      // missing `name` — required by createUserBody schema (z.string().min(1))
      phone: phone,
      role:  'participant',
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
      where: { phone: phone },
    })
    expect(inDb).toBeNull()
  })

  it('1.5b Create with phone required field)', async () => {
    const name = n('PatMissingPhone')
    const res = await post('/users', admin.token, {
      name: name,
      // role=participant but no phone — Zod passes, route-level guard rejects
      role: 'participant',
    })
    expect(res.status).toBe(400)
    const inDb = await prisma.user.findFirst({
      where: { name: name },
    })
    expect(inDb).toBeNull()
  })

  it('1.6 Create with duplicate email)', async () => {
    const name1 = n('AliceDuplicateEmail1')
    const name2 = n('AliceDuplicateEmail2')
    const email = e('alice')
    const res1 = await post('/users', admin.token, {
      name:  name1,
      email: email,
      role:  'viewer',
    })
    const res2 = await post('/users', admin.token, {
      name:  name2,
      email: email,
      role:  'viewer',
    })
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(409)
    // Asserting via name2 — email belongs to res1's row.
    const inDb = await prisma.user.findFirst({
      where: { name: name2 },
    })
    expect(inDb).toBeNull()
  })

  it('1.7 Create with duplicate phone)', async () => {
    const name1 = n('PatDuplicatePhone1')
    const name2 = n('PatDuplicatePhone2')
    const phone = '+15551000170'
    const res1 = await post('/users', admin.token, {
      name:  name1,
      phone: phone,
      role:  'participant',
    })
    const res2 = await post('/users', admin.token, {
      name:  name2,
      phone: phone,
      role:  'participant',
    })

    expect(res1.status).toBe(201)
    expect(res2.status).toBe(409)

    // Asserting via name2 (not phone) — phone belongs to res1's row.
    const inDb = await prisma.user.findFirst({
      where: { name: name2 },
    })
    expect(inDb).toBeNull()
  })

  it('1.8a — Create with malformed email role viewer', async () => {
    const name = n('AliceMalformedEmailViewer')
    const res = await post('/users', admin.token, {
      name:  name,
      email: 'alice',  // malformed — no @ — triggers the 400
      role:  'viewer',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: name },
    })
    expect(inDb).toBeNull()
  })

  it('1.8b — Create with malformed email role participant', async () => {
    const name = n('AliceMalformedEmailParticipant')
    const res = await post('/users', admin.token, {
      name:  name,
      email: 'aliceParticipant',  // malformed — no @ — triggers the 400
      role:  'participant',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: name },
    })
    expect(inDb).toBeNull()
  })

  it('1.9b — Create with malformed phone (non-E.164) role viewer', async () => {
    const name = n('AliceMalformedPhoneViewer')
    const email = e(name)
    const res = await post('/users', admin.token, {
      name:  name,
      email: email,
      phone: '050-123-4567',  // malformed E.164 — triggers the 400
      role:  'viewer',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: name },
    })
    expect(inDb).toBeNull()
  })

  it('1.9b — Create with malformed phone (non-E.164) role participant', async () => {
    const name = n('AliceMalformedPhoneParticipant')
    const email = e(name)
    const res = await post('/users', admin.token, {
      name:  name,
      email: email,
      phone: '050-123-4563',  // malformed E.164 — triggers the 400
      role:  'participant',
    })
    // Response shape
    expect(res.status).toBe(400)

    // DB state
    const inDb = await prisma.user.findFirst({
      where: { name: name },
    })
    expect(inDb).toBeNull()
  })

  it('1.10a — non-admin viewer caller → 403', async () => {
    const name  = n('BobViewerToken')
    const email = e(name.toLowerCase())
    // Use VIEWER's token (not admin's)
    const res = await post('/users', viewerRole.token, {
      name:  name,
      email: email,
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: email },
    })
    expect(inDb).toBeNull()
  })

  it('1.10b — non-admin manager caller → 403', async () => {
    const name  = n('BobManagerToken')
    const email = e(name.toLowerCase())
    // Use MANAGER's token (not admin's)
    const res = await post('/users', managerRole.token, {
      name:  name,
      email: email,
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: email },
    })
    expect(inDb).toBeNull()
  })

  it('1.10c — non-admin participant caller → 403', async () => {
    const name  = n('BobParticipantToken')
    const email = e(name.toLowerCase())
    // Use PARTICIPANT's token (not admin's)
    const res = await post('/users', participantRole.token, {
      name:  name,
      email: email,
      role:  'viewer',
    })

    expect(res.status).toBe(403)

    // No row created — the gate rejects before any DB write
    const inDb = await prisma.user.findFirst({
      where: { email: email },
    })
    expect(inDb).toBeNull()
  })

  it('1.21 — soft-delete user (DELETE /users/:id)', async () => {
    // Setup: a viewer with their own token (so we can test login-after-delete)
    const email = e('alicesoftdelete')
    const target = await seedUser({ role: 'viewer', email: email })

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
