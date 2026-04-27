import React, { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { toastSuccess, toastError } from '../../lib/toast'
import { inputSx, primaryBtn, maskPhone } from '../../lib/inputSx'
import { AdminSearchableGroupPickModal } from './AdminSearchableGroupPickModal'

export const AdminManagerGroupsTab = () => {
  const { users, groups, managerGroups, token, refresh: refreshData } = useAppData()
  const managers = users.filter(u => u.role === 'manager')
  const [mgrQuery, setMgrQuery] = useState('')
  const [mgrSort, setMgrSort] = useState('name-asc')
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  React.useEffect(() => {
    if (!selectedManagerId && managers.length > 0) setSelectedManagerId(managers[0].id)
  }, [managers])

  const groupNameById = React.useMemo(() => {
    const map: Record<number, string> = {}
    groups.forEach(g => { map[g.id] = g.name })
    return map
  }, [groups])

  const filteredMgr = managers.filter(m => {
    if (!mgrQuery.trim()) return true
    const q = mgrQuery.trim().toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || String(m.email || '').toLowerCase().includes(q)
  })

  const sortedMgr = [...filteredMgr].sort((a, b) => {
    if (mgrSort === 'name-asc') return String(a.name || '').localeCompare(String(b.name || ''))
    if (mgrSort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''))
    return 0
  })

  const sel = managers.find(m => m.id === selectedManagerId)
  const assignedIds = sel ? managerGroups.filter(l => l.managerId === sel.id).map(l => l.groupId) : []

  const applyManagerGroups = async (groupIds: number[]) => {
    if (!sel) { toastError('Select a manager first.'); return }
    setSaving(true)
    try {
      const newSet = new Set(groupIds)
      const currentSet = new Set(assignedIds)
      const toAdd = groupIds.filter(gid => !currentSet.has(gid))
      const toRemove = assignedIds.filter(gid => !newSet.has(gid))
      await Promise.all([
        ...toAdd.map(gid => apiFetch(`/groups/${gid}/managers`, token, { method: 'POST', body: { managerId: sel.id } })),
        ...toRemove.map(gid => apiFetch(`/groups/${gid}/managers/${sel.id}`, token, { method: 'DELETE' })),
      ])
      setGroupModalOpen(false)
      await refreshData()
      toastSuccess('Manager group assignment saved.')
    } catch (err: any) {
      toastError(`Could not save assignment: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', maxWidth: 960 }}>
      <div style={{ flex: '0 0 280px', minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Managers</div>
        <input placeholder="Search managers…" value={mgrQuery} onChange={e => setMgrQuery(e.target.value)} style={{ ...inputSx, marginBottom: 8 }} />
        <select value={mgrSort} onChange={e => setMgrSort(e.target.value)} style={{ ...inputSx, marginBottom: 8 }}>
          <option value="name-asc">Sort: Name A-Z</option>
          <option value="name-desc">Sort: Name Z-A</option>
        </select>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 440, overflowY: 'auto', background: 'var(--surface)' }}>
          {sortedMgr.map(m => (
            <button key={m.id} type="button" onClick={() => setSelectedManagerId(m.id)}
              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: m.id === selectedManagerId ? 'var(--primary-light)' : 'var(--surface)', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{m.email || '—'}</div>
            </button>
          ))}
          {sortedMgr.length === 0 && <div style={{ padding: 12, color: 'var(--text-3)', fontSize: 13 }}>No managers match.</div>}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 280, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        {!sel && <p style={{ color: 'var(--text-2)' }}>Select a manager from the list.</p>}
        {sel && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{sel.name}</h2>
            <div style={{ display: 'grid', gap: 8, fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
              <div><span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Email </span>{sel.email || '—'}</div>
              <div><span style={{ color: 'var(--text-3)', fontWeight: 600 }}>SMS </span>{maskPhone(sel.phone)}</div>
              <div><span style={{ color: 'var(--text-3)', fontWeight: 600 }}>ID </span>{sel.id}</div>
            </div>
            <button type="button" onClick={() => setGroupModalOpen(true)} style={{ ...primaryBtn, marginBottom: 16 }}>
              Assign groups from list…
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>
              Group links control this manager's visible schedules and recipients.
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6 }}>Assigned groups ({assignedIds.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {assignedIds.map(gid => (
                <span key={gid} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  {groupNameById[gid] || `Group ${gid}`}
                </span>
              ))}
              {assignedIds.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>None yet.</span>}
            </div>
          </>
        )}
      </div>

      {groupModalOpen && sel && (
        <AdminSearchableGroupPickModal
          title={`Assign groups — ${sel.name}`}
          initialSelected={assignedIds}
          onClose={() => setGroupModalOpen(false)}
          onSave={applyManagerGroups}
        />
      )}
    </div>
  )
}
