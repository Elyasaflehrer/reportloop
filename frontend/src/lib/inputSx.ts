import type { CSSProperties } from 'react'

export const inputSx: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  background: 'var(--surface-alt)',
  width: '100%',
  color: 'var(--text)',
  boxShadow: 'inset 0 1px 2px rgba(82,98,152,0.06)',
}

export const primaryBtn: CSSProperties = {
  background: 'var(--primary)',
  color: '#fff',
  borderRadius: 10,
  padding: '9px 16px',
  fontWeight: 600,
  fontSize: 14,
  boxShadow: '0 6px 16px rgba(91, 109, 245, 0.22)',
}

export const maskPhone = (p: string | null | undefined): string => {
  if (!p || !String(p).trim()) return '—'
  const s = String(p).trim()
  if (s.length <= 4) return '••••'
  return `••••${s.slice(-4)}`
}
