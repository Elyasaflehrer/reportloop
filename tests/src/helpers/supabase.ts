import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

export async function createAuthUser(opts: { email: string }): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email:         opts.email,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('createUser returned no user')
  return data.user.id  // real Supabase UUID
}
