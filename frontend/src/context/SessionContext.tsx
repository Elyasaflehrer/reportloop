import React from 'react'
import { supabaseClient } from '../lib/supabaseClient'
import type { Session, UserRole } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

// ─── CONTEXT ──────────────────────────────────────────────────────────────────

interface SessionContextValue {
  session: Session | null
  login: (credentials: { email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  setViewerManager: (mid: number) => void
  refreshViewerSessionFromGroups: () => Promise<void>
  activeManagerId: number | null
  needsPasswordReset: boolean
  setNeedsPasswordReset: (v: boolean) => void
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

export const useSession = () => {
  const v = React.useContext(SessionContext)
  if (!v) throw new Error('useSession must be used inside SessionProvider')
  return v
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const mapSupabaseSession = (sb: { user: { id: string; email?: string; user_metadata?: Record<string, string>; }; access_token: string }): Session => ({
  id: sb.user.id,
  email: sb.user.email ?? '',
  name: sb.user.user_metadata?.name || sb.user.email || 'User',
  initials: ((sb.user.user_metadata?.name || sb.user.email || '??').slice(0, 2)).toUpperCase(),
  role: (sb.user.user_metadata?.role || 'viewer') as UserRole,
  title: sb.user.user_metadata?.title || '',
  viewerManagerIds: [],
  activeManagerId: null,
  accessToken: sb.access_token,
})

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = React.useState<Session | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [needsPasswordReset, setNeedsPasswordReset] = React.useState(false)

  const hydrateSession = React.useCallback(async (sb: Parameters<typeof mapSupabaseSession>[0] | null) => {
    if (!sb) { setSession(null); return }
    const base = mapSupabaseSession(sb)
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${sb.access_token}` },
      })
      if (res.ok) {
        const { user, scope } = await res.json()
        setSession({
          ...base,
          role:             user.role,
          name:             user.name || base.name,
          viewerManagerIds: scope?.viewableManagerIds ?? [],
          activeManagerId:  (scope?.viewableManagerIds ?? [])[0] ?? null,
        })
        return
      }
    } catch (err) {
      console.error('[session] /auth/me failed, falling back to JWT role:', err)
    }
    setSession(base)
  }, [])

  React.useEffect(() => {
    if (!supabaseClient) { setLoading(false); return }
    supabaseClient.auth.getSession()
      .then(({ data: { session: sb } }) => hydrateSession(sb as Parameters<typeof hydrateSession>[0]))
      .catch((err) => console.error('getSession failed:', err))
      .finally(() => setLoading(false))
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, sb) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPasswordReset(true)
      hydrateSession(sb as Parameters<typeof hydrateSession>[0])
    })
    return () => subscription.unsubscribe()
  }, [hydrateSession])

  const login = async ({ email, password }: { email: string; password: string }) => {
    if (!supabaseClient) throw new Error('Supabase is not configured.')
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const logout = async () => {
    if (supabaseClient) await supabaseClient.auth.signOut()
    setSession(null)
  }

  const setViewerManager = (mid: number) => {
    setSession((cur) => cur ? { ...cur, activeManagerId: mid } : cur)
  }

  const refreshViewerSessionFromGroups = React.useCallback(async () => {
    if (!supabaseClient) return
    const { data: { session: sb } } = await supabaseClient.auth.getSession()
    if (sb) await hydrateSession(sb as Parameters<typeof hydrateSession>[0])
  }, [hydrateSession])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-2)', fontSize: 14 }}>
        Loading…
      </div>
    )
  }

  return (
    <SessionContext.Provider value={{
      session,
      login,
      logout,
      setViewerManager,
      refreshViewerSessionFromGroups,
      activeManagerId: session?.role === 'viewer' ? session.activeManagerId : null,
      needsPasswordReset,
      setNeedsPasswordReset,
    }}>
      {children}
    </SessionContext.Provider>
  )
}
