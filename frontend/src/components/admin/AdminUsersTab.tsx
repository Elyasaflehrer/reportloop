import React, { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { toastSuccess, toastError, confirmDiscardUnsaved } from '../../lib/toast'
import { inputSx, primaryBtn, maskPhone } from '../../lib/inputSx'
import { Modal } from '../ui/Modal'
import { AdminSearchableGroupPickModal } from './AdminSearchableGroupPickModal'
import type { User } from '../../types'

type Draft = { name: string; email: string; phone: string; role: string }
type EditUser = User & { __baseline?: { name: string; email: string; phone: string; role: string } }

export const AdminUsersTab = () => {
  const { users, groups, token, refresh } = useAppData()
  const [rowQuery, setRowQuery] = useState('')
  const [draft, setDraft] = useState<Draft>({ name: '', email: '', phone: '', role: 'viewer' })
  const [sortBy, setSortBy] = useState('name-asc')
  const [filterRole, setFilterRole] = useState('all')
  const [filterGroupName, setFilterGroupName] = useState('')
  const [density, setDensity] = useState('comfortable')
  const [edit, setEdit] = useState<EditUser | null>(null)
  const [groupPickUserId, setGroupPickUserId] = useState<number | null>(null)
  const [viewGroupsUserId, setViewGroupsUserId] = useState<number | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(() => new Set())
  const [bulkGroupModalOpen, setBulkGroupModalOpen] = useState(false)
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const groupNameById = React.useMemo(() => {
    const map: Record<number, string> = {}
    groups.forEach(g => { map[g.id] = g.name })
    return map
  }, [groups])

  const groupsForUserId = (userId: number) =>
    groups.filter(g => ((g as any).memberIds || []).includes(userId)).map(g => g.id)

  const groupNamesForUser = (userId: number) =>
    groupsForUserId(userId).map(gid => groupNameById[gid] || `Group ${gid}`)

  const groupSortKeyForUser = (userId: number) => {
    const names = groupNamesForUser(userId).map(n => String(n).toLowerCase()).sort()
    if (!names.length) return '~~~'
    return names.join(' | ')
  }

  const addUser = async () => {
    if (!draft.name.trim()) { toastError('Could not add user: name is required.'); return }
    if (draft.role !== 'participant' && !draft.email.trim()) { toastError('Could not add user: email is required.'); return }
    if (draft.role === 'participant' && !draft.phone.trim()) { toastError('Could not add user: phone is required for participants.'); return }
    setSaving(true)
    try {
      const body: Record<string, string> = { name: draft.name.trim(), role: draft.role }
      if (draft.email.trim()) body.email = draft.email.trim()
      if (draft.phone.trim()) body.phone = draft.phone.trim()
      await apiFetch('/users', token, { method: 'POST', body })
      setDraft({ name: '', email: '', phone: '', role: 'viewer' })
      await refresh()
      toastSuccess(`User added: ${draft.name.trim()}.`)
    } catch (err: any) {
      toastError(`Could not add user: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    const removed = users.find(r => r.id === id)
    setSaving(true)
    try {
      await apiFetch(`/users/${id}`, token, { method: 'DELETE' })
      setSelectedUserIds(prev => { const n = new Set(prev); n.delete(id); return n })
      await refresh()
      toastSuccess(`User removed${removed ? `: ${removed.name}` : ''}.`)
    } catch (err: any) {
      toastError(`Could not remove user: ${err.message}`)
    } finally {
      setSaving(false)
      setPendingRemoveUserId(null)
    }
  }

  const saveEdit = async () => {
    if (!edit) return
    if (!edit.name?.trim()) { toastError('Could not save user: name is required.'); return }
    setSaving(true)
    try {
      const body: Record<string, string> = { name: edit.name.trim(), role: edit.role }
      if (edit.email?.trim()) body.email = edit.email.trim()
      if ((edit.phone || '').trim()) body.phone = edit.phone!.trim()
      await apiFetch(`/users/${edit.id}`, token, { method: 'PATCH', body })
      setEdit(null)
      await refresh()
      toastSuccess('User changes saved.')
    } catch (err: any) {
      toastError(`Could not save user: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const setUserGroupMembershipsAPI = async (userId: number, newGroupIds: number[]) => {
    const currentGroupIds = groupsForUserId(userId)
    const newSet = new Set(newGroupIds)
    const currentSet = new Set(currentGroupIds)
    const toAdd = newGroupIds.filter(gid => !currentSet.has(gid))
    const toRemove = currentGroupIds.filter(gid => !newSet.has(gid))
    await Promise.all([
      ...toAdd.map(gid => apiFetch(`/groups/${gid}/members`, token, { method: 'POST', body: { userId } })),
      ...toRemove.map(gid => apiFetch(`/groups/${gid}/members/${userId}`, token, { method: 'DELETE' })),
    ])
  }

  const isUserEditDirty = (e: EditUser) => {
    if (!e.__baseline) return false
    const cur = { name: String(e.name || '').trim(), email: String(e.email || '').trim(), phone: String(e.phone || '').trim(), role: e.role }
    const base = e.__baseline
    return cur.name !== base.name || cur.email !== base.email || cur.phone !== base.phone || cur.role !== base.role
  }

  const requestCloseUserEdit = () => {
    if (edit && isUserEditDirty(edit) && !confirmDiscardUnsaved('user editor')) return
    setEdit(null)
  }

  const filteredRows = users.filter(r => {
    const q = rowQuery.trim().toLowerCase()
    const groupsText = groupNamesForUser(r.id).join(' ').toLowerCase()
    const baseMatch = !q || (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || String(r.role || '').toLowerCase().includes(q) || groupsText.includes(q)
    if (!baseMatch) return false
    if (filterRole !== 'all' && r.role !== filterRole) return false
    if (filterGroupName.trim() && !groupsText.includes(filterGroupName.trim().toLowerCase())) return false
    return true
  })

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sortBy === 'name-asc') return String(a.name || '').localeCompare(String(b.name || ''))
    if (sortBy === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''))
    if (sortBy === 'role') return String(a.role || '').localeCompare(String(b.role || ''))
    if (sortBy === 'groups-desc') return groupsForUserId(b.id).length - groupsForUserId(a.id).length
    if (sortBy === 'groups-name') {
      const aKey = groupSortKeyForUser(a.id)
      const bKey = groupSortKeyForUser(b.id)
      if (aKey === bKey) return String(a.name || '').localeCompare(String(b.name || ''))
      return aKey.localeCompare(bKey)
    }
    return 0
  })

  const visibleUserIds = new Set(sortedRows.map(r => r.id))
  const selectedVisibleUserIds = [...selectedUserIds].filter(uid => visibleUserIds.has(uid))
  const hiddenSelectedUserIds = [...selectedUserIds].filter(uid => !visibleUserIds.has(uid))

  const toggleSelectedUser = (uid: number) => {
    setSelectedUserIds(prev => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Add user form */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Add user</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Name</div>
            <input placeholder="Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inputSx} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Email</div>
            <input placeholder="Email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} style={inputSx} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Phone (E.164)</div>
            <input placeholder="+1…" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} style={inputSx} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Role</div>
            <select value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} style={inputSx}>
              <option value="admin">admin</option>
              <option value="manager">manager</option>
              <option value="viewer">viewer</option>
              <option value="participant">participant</option>
            </select>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', padding: '8px 0', alignSelf: 'center', gridColumn: '1 / -1' }}>
            {draft.role === 'participant'
              ? 'Participants receive SMS prompts — phone is required, no platform login. Assign them to a group after creating.'
              : draft.role === 'viewer'
              ? 'Viewer access is determined by group membership — add the user to groups after creating them.'
              : 'An invite email will be sent so the user can set their own password.'}
          </div>
        </div>
        <button type="button" onClick={addUser} disabled={saving} style={{ marginTop: 12, ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
          Add user
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search users by name/email/role/group…" value={rowQuery} onChange={e => setRowQuery(e.target.value)} style={{ ...inputSx, maxWidth: 320 }} />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={{ ...inputSx, width: 140 }}>
          <option value="all">Role: All</option>
          <option value="admin">Role: Admin</option>
          <option value="manager">Role: Manager</option>
          <option value="viewer">Role: Viewer</option>
          <option value="participant">Role: Participant</option>
        </select>
        <input placeholder="Filter group name…" value={filterGroupName} onChange={e => setFilterGroupName(e.target.value)} style={{ ...inputSx, width: 180 }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inputSx, width: 200 }}>
          <option value="name-asc">Sort: Name A-Z</option>
          <option value="name-desc">Sort: Name Z-A</option>
          <option value="role">Sort: Role</option>
          <option value="groups-name">Sort: Group (by name)</option>
          <option value="groups-desc">Sort: Groups (high-low)</option>
        </select>
        <select value={density} onChange={e => setDensity(e.target.value)} style={{ ...inputSx, width: 170 }}>
          <option value="comfortable">Density: Comfortable</option>
          <option value="compact">Density: Compact</option>
        </select>
        <button
          type="button"
          disabled={selectedVisibleUserIds.length === 0}
          onClick={() => {
            if (hiddenSelectedUserIds.length > 0) toastError(`Ignoring ${hiddenSelectedUserIds.length} selected user(s) hidden by current filters.`)
            setBulkGroupModalOpen(true)
          }}
          style={{ ...primaryBtn, opacity: selectedVisibleUserIds.length === 0 ? 0.5 : 1, cursor: selectedVisibleUserIds.length === 0 ? 'not-allowed' : 'pointer' }}
        >
          Replace groups for selected ({selectedVisibleUserIds.length})
        </button>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', maxHeight: 540 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 100px 100px 80px 140px', minWidth: 780, gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 2 }}>
          <span>Select</span><span>Name</span><span>Email</span><span>Role</span><span>SMS (masked)</span><span>Groups</span><span>Actions</span>
        </div>
        {sortedRows.map((r, idx) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 100px 100px 80px 140px', minWidth: 780, gap: 8, padding: density === 'compact' ? '8px 14px' : '12px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center', fontSize: 14, background: idx % 2 ? 'var(--surface)' : 'oklch(99% 0.003 240)' }}>
            <span><input type="checkbox" checked={selectedUserIds.has(r.id)} onChange={() => toggleSelectedUser(r.id)} /></span>
            <span title={r.name} style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
            <span title={r.email ?? ''} style={{ color: 'var(--text-2)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
            <span>{r.role}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{maskPhone(r.phone)}</span>
            <span>
              <button type="button" onClick={() => setViewGroupsUserId(r.id)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', border: '1px solid var(--primary)', background: 'var(--primary-light)', borderRadius: 6, padding: '4px 10px' }}>
                View groups
              </button>
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEdit({ ...r, __baseline: { name: String(r.name || '').trim(), email: String(r.email || '').trim(), phone: String(r.phone || '').trim(), role: r.role } })} style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>Edit</button>
              <button type="button" onClick={() => setGroupPickUserId(r.id)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Groups…</button>
              <button type="button" onClick={() => setPendingRemoveUserId(r.id)} style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {edit && (
        <Modal title={`Edit user — ${edit.name}`} onClose={requestCloseUserEdit} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>User ID <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}>{edit.id}</span></div>
            <div><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</div><input value={edit.name || ''} onChange={e => setEdit(x => x ? { ...x, name: e.target.value } : x)} style={inputSx} /></div>
            <div><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Email</div><input value={edit.email || ''} onChange={e => setEdit(x => x ? { ...x, email: e.target.value } : x)} style={inputSx} /></div>
            <div><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phone (E.164)</div><input value={edit.phone || ''} onChange={e => setEdit(x => x ? { ...x, phone: e.target.value } : x)} style={inputSx} /></div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Role</div>
              <select value={edit.role} onChange={e => setEdit(x => x ? { ...x, role: e.target.value as any } : x)} style={inputSx}>
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" onClick={requestCloseUserEdit} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Cancel</button>
              <button type="button" onClick={saveEdit} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>Save changes</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Group pick modal */}
      {groupPickUserId != null && (
        <AdminSearchableGroupPickModal
          title="Assign groups to user"
          initialSelected={groupsForUserId(groupPickUserId)}
          onClose={() => setGroupPickUserId(null)}
          onSave={async ids => {
            setSaving(true)
            try {
              await setUserGroupMembershipsAPI(groupPickUserId, ids)
              await refresh()
              toastSuccess('User groups updated.')
            } catch (err: any) {
              toastError(`Could not update groups: ${err.message}`)
            } finally {
              setSaving(false)
              setGroupPickUserId(null)
            }
          }}
        />
      )}

      {/* Bulk group modal */}
      {bulkGroupModalOpen && (
        <AdminSearchableGroupPickModal
          title={`Replace groups for selected users (${selectedVisibleUserIds.length})`}
          initialSelected={[]}
          onClose={() => setBulkGroupModalOpen(false)}
          onSave={async ids => {
            const selected = [...selectedVisibleUserIds]
            const names = ids.map(gid => groupNameById[gid] || `Group ${gid}`)
            const hiddenCount = hiddenSelectedUserIds.length
            const proceed = confirm(`Apply group replacement to ${selected.length} visible user(s)?${hiddenCount ? `\n${hiddenCount} hidden selected user(s) will be skipped.` : ''}\n\nNew groups: ${names.length ? names.join(', ') : 'None'}`)
            if (!proceed) return
            setSaving(true)
            try {
              await Promise.all(selected.map(uid => setUserGroupMembershipsAPI(uid, ids)))
              setBulkGroupModalOpen(false)
              setSelectedUserIds(new Set())
              await refresh()
              toastSuccess(`Bulk group update complete: updated ${selected.length} users.`)
            } catch (err: any) {
              toastError(`Bulk update failed: ${err.message}`)
            } finally {
              setSaving(false)
            }
          }}
        />
      )}

      {/* Remove confirm modal */}
      {pendingRemoveUserId != null && (
        <Modal title="Remove user?" onClose={() => setPendingRemoveUserId(null)} width={420}>
          {(() => {
            const user = users.find(r => r.id === pendingRemoveUserId)
            return (
              <div>
                <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.5 }}>
                  Remove <b>{user?.name || 'this user'}</b>{user?.email ? ` (${user.email})` : ''}? This action cannot be undone.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={() => setPendingRemoveUserId(null)} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Cancel</button>
                  <button type="button" onClick={() => remove(pendingRemoveUserId!)} disabled={saving} style={{ background: 'var(--red)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>Remove</button>
                </div>
              </div>
            )
          })()}
        </Modal>
      )}

      {/* View groups modal */}
      {viewGroupsUserId != null && (
        <Modal title="User groups" onClose={() => setViewGroupsUserId(null)} width={420}>
          {(() => {
            const user = users.find(r => r.id === viewGroupsUserId)
            const names = groupNamesForUser(viewGroupsUserId)
            return (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
                  {user ? user.name : 'User'} is attached to {names.length} group{names.length === 1 ? '' : 's'}.
                </div>
                {names.length === 0
                  ? <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No groups attached yet.</div>
                  : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {names.map(name => <span key={name} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 99, background: 'var(--bg)', border: '1px solid var(--border)' }}>{name}</span>)}
                    </div>
                }
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button type="button" onClick={() => setViewGroupsUserId(null)} style={{ ...primaryBtn, padding: '8px 16px' }}>Close</button>
                </div>
              </div>
            )
          })()}
        </Modal>
      )}
    </div>
  )
}
