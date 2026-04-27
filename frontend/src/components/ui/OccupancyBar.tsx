export const OccupancyBar = ({ pct }: { pct: number }) => {
  const color = pct >= 65 ? 'var(--green)' : pct >= 55 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'var(--border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: color, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32 }}>{pct}%</span>
    </div>
  )
}
