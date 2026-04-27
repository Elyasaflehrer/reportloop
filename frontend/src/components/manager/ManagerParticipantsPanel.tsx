import React, { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { inputSx, maskPhone } from '../../lib/inputSx'

export const ManagerParticipantsPanel = () => {
  const { participants, groups } = useAppData()
  const [search, setSearch] = useState('')

  const groupNamesByUserId = React.useMemo(() => {
    const map: Record<number, string[]> = {}
    groups.forEach(g => {
      ((g as any).memberIds || []).forEach((uid: number) => {
        if (!map[uid]) map[uid] = []
        map[uid].push(g.name)
      })
    })
    return map
  }, [groups])

  const filtered = participants.filter(p => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q)
  })

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ color: 'var(--text-2)', marginBottom: 16, fontSize: 14 }}>
        Participants assigned to your groups. Managed by admin — contact your admin to add or remove participants.
      </p>
      <input placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputSx, marginBottom: 16, maxWidth: 320 }} />
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {filtered.length === 0 && participants.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            No participants assigned to your groups yet. Ask your admin to assign participants.
          </div>
        )}
        {filtered.length === 0 && participants.length > 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>No participants match search.</div>
        )}
        {filtered.map(p => (
          <div key={p.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'ui-monospace,monospace' }}>{maskPhone(p.phone)}</div>
              {(groupNamesByUserId[p.id] || []).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
                  Groups: {(groupNamesByUserId[p.id] || []).join(', ')}
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', borderRadius: 99, padding: '2px 8px', background: p.active ? 'var(--green-bg)' : 'var(--border)', color: p.active ? 'var(--green)' : 'var(--text-3)' }}>
              {p.active ? 'Active' : 'Inactive'}
            </span>
            {p.smsOptedOut && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-bg)', borderRadius: 99, padding: '2px 8px' }}>SMS opt-out</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
