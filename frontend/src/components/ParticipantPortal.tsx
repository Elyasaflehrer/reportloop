import { useSession } from '../context/SessionContext'
import { History } from './history/History'

export const ParticipantPortal = () => {
  const { session, logout } = useSession()

  if (!session) return null

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
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <History
          title="Correspondences"
          subtitle="Open a broadcast, then View Log for AI Analysis and Full Transcript. Nothing appears here until your first report has started."
          emptyMessage="No check-ins yet. Your reports will appear here after the first one has started."
        />
      </main>
    </div>
  )
}
