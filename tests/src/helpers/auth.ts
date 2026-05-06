// Mints Supabase-shaped JWTs locally using SUPABASE_JWT_SECRET. Used by tests
// to authenticate as arbitrary roles without going through Supabase's login
// flow. The backend's auth middleware verifies these the same as real ones.
import crypto from 'node:crypto'

const SECRET = process.env.SUPABASE_JWT_SECRET
if (!SECRET) {
  throw new Error(
    '[tests/auth] SUPABASE_JWT_SECRET is not set. ' +
    'Copy .env.example to .env and set the same value as backend/.env.',
  )
}

const base64url = (input: string): string =>
  Buffer.from(input).toString('base64url')

export function signTestToken(opts: {
  supabaseId:        string
  email:            string | null
  expiresInSeconds?: number
}): string {
  const now = Math.floor(Date.now() / 1000)

  const header = base64url(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT',
  }))

  const payload = base64url(JSON.stringify({
    sub:   opts.supabaseId,
    aud:   'authenticated',
    role:  'authenticated',
    email: opts.email ?? `test-${opts.supabaseId}@test.local`,
    iat:   now,
    exp:   now + (opts.expiresInSeconds ?? 3600),
  }))

  const signature = crypto
    .createHmac('sha256', SECRET!)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${signature}`
}
