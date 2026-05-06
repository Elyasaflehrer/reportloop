// User CRUD tests against POST /users.
//
// Each test wipes the DB, seeds a single admin (so we have someone to
// authenticate as), then exercises the API and asserts on the response
// + the resulting DB row.

import { beforeEach, describe, it, expect } from 'vitest'
import { post } from '../helpers/api'
import { signTestToken } from '../helpers/auth'
import { createAuthUser } from '../helpers/supabase'
import { prisma, truncateAll } from '../helpers/db'

describe('User CRUD — POST /users', () => {
  let adminToken: string

  beforeEach(async () => {
    await truncateAll()
    const supabaseId = await createAuthUser({ email: 'admin@test.local' })
    // Seed an admin via direct DB write so we have authority to call the API.
    // Setup uses Prisma; behavior under test goes through HTTP.
    const admin = await prisma.user.create({
      data: {
        name: 'Test Admin',
        email: 'admin@test.local',
        role: 'admin',
        supabaseId: supabaseId
      },
    })
    adminToken = signTestToken({ email: admin.email, supabaseId: supabaseId })
  })

  it('1.3 — admin creates a viewer user', async () => {
    const res = await post('/users', adminToken, {
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
})
