import { useSession } from '../../context/SessionContext'
import { useAppData } from '../../context/AppDataContext'
import { inputSx } from '../../lib/inputSx'

export const ViewerManagerBar = () => {
  const { session, setViewerManager } = useSession()
  const { users } = useAppData()

  if (!session || session.role !== 'viewer') return null
  const ids = session.viewerManagerIds ?? []
  if (ids.length <= 1) return null

  return (
    <div style={{ padding: '8px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
      <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>Manager context</span>
      <select
        value={session.activeManagerId ?? ''}
        onChange={e => setViewerManager(Number(e.target.value))}
        style={{ ...inputSx, width: 'auto', minWidth: 200 }}
      >
        {ids.map(mid => {
          const u = users.find(x => x.role === 'manager' && x.id === mid)
          return (
            <option key={mid} value={mid}>
              {u ? u.name : 'Manager'} ({mid})
            </option>
          )
        })}
      </select>
    </div>
  )
}
