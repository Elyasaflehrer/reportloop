import { useSession } from '../context/SessionContext'
import { History } from './history/History'

export const ParticipantPortal = () => {
  const { session, logout } = useSession()

  if (!session) return null

  const managers = session.viewableManagers ?? []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Your check-ins</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{session.name}</div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          Log out
        </button>
      </header>

      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {managers.length === 0 ? (
          <History
            title="Correspondences"
            subtitle="Open a broadcast, then View Log for AI Analysis and Full Transcript."
            emptyMessage="No check-ins yet. Your reports will appear here after the first one has started."
          />
        ) : (
          managers.map(m => (
            <div key={m.id} style={{ borderBottom: '2px solid var(--border)' }}>
              <History
                managerFilterId={m.id}
                title={m.name}
                subtitle="Your conversations with this manager."
                emptyMessage="No check-ins yet from this manager."
              />
            </div>
          ))
        )}
      </main>
    </div>
  )
}
