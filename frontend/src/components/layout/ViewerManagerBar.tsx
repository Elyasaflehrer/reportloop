import { useSession } from '../../context/SessionContext'
import { inputSx } from '../../lib/inputSx'

export const ViewerManagerBar = () => {
  const { session, setViewerManager } = useSession()

  if (!session || session.role !== 'viewer') return null
  const managers = session.viewableManagers ?? []
  if (managers.length === 0) return null

  return (
    <div style={{ padding: '8px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
      <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>Manager context</span>
      <select
        value={session.activeManagerId ?? ''}
        onChange={e => setViewerManager(Number(e.target.value))}
        style={{ ...inputSx, width: 'auto', minWidth: 200 }}
      >
        {managers.map(m => (
          <option key={m.id} value={m.id}>
            {m.name} · {m.access === 'full' ? 'All conversations' : 'Your history only'}
          </option>
        ))}
      </select>
    </div>
  )
}
