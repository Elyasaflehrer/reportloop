import { useSession } from '../context/SessionContext'
import { StatCard } from './ui/StatCard'

const REPORT_TOPICS = [
  'Occupancy rate', 'Delinquencies', 'Maintenance issues', 'Rate structure',
  'Rooms out of service', 'Ready rooms', 'Police calls', 'Holiday preparations', 'Advertising needs',
]

type Props = { onNav: (page: string) => void }

export const Dashboard = ({ onNav }: Props) => {
  const { session } = useSession()
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{greeting}, {session?.name?.split(' ')[0] ?? 'there'}</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>{dateStr} — Waiting for reports.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Avg Occupancy" value="—" sub="No reports yet" />
        <StatCard label="Reports Today" value="0" sub="0 complete, 0 active" />
        <StatCard label="Open Delinquencies" value="1" sub="Room 14 — $420 owed" color="amber" />
        <StatCard label="Rooms Down" value="2" sub="Est. cost to restore $800" />
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)', marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Today's Broadcast</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No broadcast sent today</div>
          </div>
          <button onClick={() => onNav('monitor')} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            ◉ Monitor Live
          </button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No participants in current broadcast.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Occupancy by Property</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No data yet.</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Report Topics Tracked</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {REPORT_TOPICS.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>
                <span style={{ color: 'var(--text-2)' }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
