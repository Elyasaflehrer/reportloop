import { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Modal } from '../ui/Modal'
import { inputSx, primaryBtn } from '../../lib/inputSx'

interface Props {
  title: string
  initialSelected: number[]
  onClose: () => void
  onSave: (ids: number[]) => void
}

export const AdminSearchableGroupPickModal = ({ title, initialSelected, onClose, onSave }: Props) => {
  const { groups: allGroups } = useAppData()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set(initialSelected))

  const groups = allGroups.filter(g => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase()))

  const toggle = (gid: number) => {
    setSel(prev => {
      const n = new Set(prev)
      if (n.has(gid)) n.delete(gid)
      else n.add(gid)
      return n
    })
  }

  return (
    <Modal title={title} onClose={onClose} width={480}>
      <input placeholder="Search groups…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputSx, marginBottom: 12 }} />
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
        {groups.map(g => (
          <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 14 }}>
            <input type="checkbox" checked={sel.has(g.id)} onChange={() => toggle(g.id)} />
            {g.name}
          </label>
        ))}
        {groups.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No matches.</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onClose} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>
          Cancel
        </button>
        <button type="button" onClick={() => onSave([...sel])} style={primaryBtn}>
          Save
        </button>
      </div>
    </Modal>
  )
}
