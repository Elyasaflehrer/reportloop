// Test fixtures: bundles the three coupled setup steps every authenticated test
// needs — Supabase auth user, Prisma user row, signed JWT — into one call.
//
// Use these for SETUP ONLY. Behavior under test goes through HTTP (helpers/api.ts).

import type { User } from '@prisma/client'
import { prisma } from './db'
import { createAuthUser } from './supabase'
import { signTestToken } from './auth'

export type SeededUser = {
  user:       User
  token:      string
  supabaseId: string
}

// Seeds an admin / manager / viewer (any role with an email + Supabase identity).
// Participants are not yet supported — they have no email and no Supabase login.
export async function seedUser(opts: {
  role:  'admin' | 'manager' | 'viewer' |'participant'
  email: string
  name?: string
}): Promise<SeededUser> {
  const supabaseId = await createAuthUser({ email: opts.email })
  const user = await prisma.user.create({
    data: {
      name:       opts.name ?? `Test ${opts.role}`,
      email:      opts.email,
      role:       opts.role,
      supabaseId,
    },
  })
  const token = signTestToken({ email: user.email, supabaseId })
  return { user, token, supabaseId }
}

export const seedAdmin = (opts: { email: string; name?: string }) =>
  seedUser({ role: 'admin', ...opts })
