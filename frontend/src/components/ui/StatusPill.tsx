interface StatusPillProps {
  status: 'completed' | 'in-progress' | 'pending' | 'failed'
}

const map: Record<string, { label: string; bg: string; color: string }> = {
  completed:    { label: 'Completed',   bg: 'var(--green-bg)', color: 'var(--green)' },
  'in-progress':{ label: 'In Progress', bg: 'var(--amber-bg)', color: 'var(--amber)' },
  pending:      { label: 'Pending',     bg: 'var(--border)',   color: 'var(--text-3)' },
  failed:       { label: 'Failed',      bg: 'var(--red-bg)',   color: 'var(--red)' },
}

export const StatusPill = ({ status }: StatusPillProps) => {
  const s = map[status] ?? map.pending
  return (
    <span style={{
      background: s.bg, color: s.color, fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 99, letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}
