interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  color?: string
}

export const StatCard = ({ label, value, sub, color = 'text' }: StatCardProps) => (
  <div style={{
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: '20px 22px', boxShadow: 'var(--shadow)',
  }}>
    <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500, marginBottom: 6, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
      {label}
    </div>
    <div style={{ fontSize: 30, fontWeight: 700, color: `var(--${color})`, lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
  </div>
)
