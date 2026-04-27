import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { supabaseClient } from '../../lib/supabaseClient'

const cardSx  = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }
const innerSx = { background: 'var(--surface)', padding: 32, borderRadius: 12, maxWidth: 440, width: '100%', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }
const inputSx = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }
const labelSx = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5, color: 'var(--text-2)' }

export const ResetPasswordForm = () => {
  const { setNeedsPasswordReset } = useSession()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabaseClient!.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      setTimeout(() => setNeedsPasswordReset(false), 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={cardSx}>
      <div style={innerSx}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Set new password</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 24 }}>AI Reporter — Hotel Operations</p>
        {done ? (
          <p style={{ color: 'var(--green)', fontSize: 14 }}>Password updated. Signing you in…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSx}>New password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" style={inputSx} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelSx}>Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" style={inputSx} />
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: 11, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
