import { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { toastSuccess, toastError, confirmDiscardUnsaved } from '../../lib/toast'
import { inputSx, primaryBtn } from '../../lib/inputSx'
import { Modal } from '../ui/Modal'

type GroupModal = {
  id?: number
  name: string
  description: string
  __baseline?: { name: string; description: string }
}

export const AdminGroupsTab = () => {
  const { users, groups, token, refresh: refreshData } = useAppData()
  const [modal, setModal] = useState<GroupModal | null>(null)
  const [editingMemberIds, setEditingMemberIds] = useState<Set<number>>(() => new Set())
  const [saving, setSaving] = useState(false)

  const openCreate = () => {
    setModal({ name: '', description: '', __baseline: { name: '', description: '' } })
    setEditingMemberIds(new Set())
  }

  const openEdit = (g: any) => {
    setModal({ id: g.id, name: g.name, description: g.description || '', __baseline: { name: String(g.name || ''), description: String(g.description || '') } })
    setEditingMemberIds(new Set(g.memberIds || []))
  }

  const saveModal = async () => {
    if (!modal || !modal.name.trim()) { toastError('Could not save group: name is required.'); return }
    setSaving(true)
    try {
      if (modal.id == null) {
        await apiFetch('/groups', token, { method: 'POST', body: { name: modal.name.trim(), description: modal.description?.trim() || undefined } })
        toastSuccess('Group created.')
      } else {
        await apiFetch(`/groups/${modal.id}`, token, { method: 'PATCH', body: { name: modal.name.trim(), description: modal.description?.trim() || undefined } })
        const currentGroup = groups.find(g => g.id === modal.id)
        const currentIds = new Set((currentGroup as any)?.memberIds || [])
        const toAdd = [...editingMemberIds].filter(uid => !currentIds.has(uid))
        const toRemove = [...currentIds as Set<number>].filter(uid => !editingMemberIds.has(uid))
        await Promise.all([
          ...toAdd.map(uid => apiFetch(`/groups/${modal.id}/members`, token, { method: 'POST', body: { userId: uid } })),
          ...toRemove.map(uid => apiFetch(`/groups/${modal.id}/members/${uid}`, token, { method: 'DELETE' })),
        ])
        toastSuccess('Group changes saved.')
      }
      setModal(null)
      await refreshData()
    } catch (err: any) {
      toastError(`Could not save group: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const deleteGroup = async (id: number) => {
    if (!confirm('Delete this group? This will remove all member and manager links.')) return
    const target = groups.find(g => g.id === id)
    setSaving(true)
    try {
      await apiFetch(`/groups/${id}`, token, { method: 'DELETE' })
      await refreshData()
      toastSuccess(`Group deleted${target ? `: ${target.name}` : ''}.`)
    } catch (err: any) {
      toastError(`Could not delete group: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleMember = (userId: number) => {
    setEditingMemberIds(prev => { const n = new Set(prev); if (n.has(userId)) n.delete(userId); else n.add(userId); return n })
  }

  const isGroupModalDirty = (m: GroupModal) => {
    if (!m.__baseline) return false
    return String(m.name || '').trim() !== String(m.__baseline.name || '').trim() || String(m.description || '').trim() !== String(m.__baseline.description || '').trim()
  }

  const requestCloseGroupModal = () => {
    if (modal && isGroupModalDirty(modal) && !confirmDiscardUnsaved('group editor')) return
    setModal(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button type="button" onClick={openCreate} style={{ ...primaryBtn, width: 'fit-content' }}>Create group</button>
      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
        Group membership controls who appears in manager rosters and viewer context.
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {groups.map(g => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{g.name}</div>
              {g.description && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{g.description}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{((g as any).memberIds || []).length} member{((g as any).memberIds || []).length !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => openEdit(g)} style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>Edit</button>
              <button type="button" onClick={() => deleteGroup(g.id)} disabled={saving} style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>Delete</button>
            </div>
          </div>
        ))}
        {groups.length === 0 && <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>No groups yet. Create one to get started.</div>}
      </div>

      {modal && (
        <Modal title={modal.id == null ? 'Create group' : 'Edit group'} onClose={requestCloseGroupModal} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</div><input value={modal.name} onChange={e => setModal(x => x ? { ...x, name: e.target.value } : x)} style={inputSx} /></div>
            <div><div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Description (optional)</div><input value={modal.description || ''} onChange={e => setModal(x => x ? { ...x, description: e.target.value } : x)} style={inputSx} /></div>
            {modal.id != null && users.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginTop: 4 }}>Members</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {users.map(u => (
                    <label key={u.id} style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={editingMemberIds.has(u.id)} onChange={() => toggleMember(u.id)} />
                      {u.name} ({u.role})
                    </label>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" onClick={requestCloseGroupModal} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Cancel</button>
              <button type="button" onClick={saveModal} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{modal.id == null ? 'Create' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
