import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { supabaseClient } from '../../lib/supabaseClient'

const cardSx  = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }
const innerSx = { background: 'var(--surface)', padding: 32, borderRadius: 12, maxWidth: 440, width: '100%', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }
const inputSx = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }
const labelSx = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: 'var(--text-2)' }

export const LoginWall = () => {
  const { login } = useSession()
  const [view, setView] = useState<'login' | 'forgot' | 'sent'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!supabaseClient) {
    return (
      <div style={cardSx}>
        <div style={innerSx}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>AI Reporter</h1>
          <p style={{ color: 'var(--red)', fontSize: 14, lineHeight: 1.5 }}>
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>.
          </p>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabaseClient!.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: window.location.href,
      })
      if (error) throw error
      setView('sent')
    } catch (err: any) {
      setError(err.message || 'Could not send reset email. Check the address and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (view === 'sent') {
    return (
      <div style={cardSx}>
        <div style={innerSx}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Check your email</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 20 }}>
            We sent a password reset link to <strong>{forgotEmail}</strong>. Click the link in the email to set a new password.
          </p>
          <button onClick={() => { setView('login'); setError(null) }} style={{ fontSize: 13, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (view === 'forgot') {
    return (
      <div style={cardSx}>
        <div style={innerSx}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Reset password</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 24 }}>Enter your email and we'll send a reset link.</p>
          <form onSubmit={handleForgot}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelSx}>Email</label>
              <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required autoComplete="email" style={inputSx} />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: 11, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1, marginBottom: 14 }}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <button onClick={() => { setView('login'); setError(null) }} style={{ fontSize: 13, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={cardSx}>
      <div style={innerSx}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Sign in</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 24 }}>AI Reporter — Hotel Operations</p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSx}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" style={inputSx} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={labelSx}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" style={inputSx} />
          </div>
          <div style={{ textAlign: 'right', marginBottom: 20 }}>
            <button type="button" onClick={() => { setView('forgot'); setForgotEmail(email); setError(null) }} style={{ fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Forgot password?
            </button>
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 11, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
