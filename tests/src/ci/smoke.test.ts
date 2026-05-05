// Smoke tests — confirm the test harness can reach the backend and that
// auth gates respond as expected. No DB writes, no auth tokens needed.
//
// Run with: npm test -- --project ci
// Backend must be running separately (cd backend && npm run dev).

import { describe, it, expect } from 'vitest'
import { get, post, del } from '../helpers/api.ts'

describe('Smoke — backend reachable, auth gates work', () => {
  it('GET /auth/me without token → 401', async () => {
    const res = await get('/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /users without token → 401', async () => {
    const res = await get('/users')
    expect(res.status).toBe(401)
  })

  it('POST /users without token → 401', async () => {
    const res = await post('/users', '', { name: 'X', email: 'x@x.com', role: 'admin' })
    expect(res.status).toBe(401)
  })

  it('DELETE /users/1 without token → 401', async () => {
    const res = await del('/users/1', '')
    expect(res.status).toBe(401)
  })

  it('GET /users with bogus token → 401', async () => {
    const res = await get('/users', 'fake.totally.bogus.jwt')
    expect(res.status).toBe(401)
  })
})
