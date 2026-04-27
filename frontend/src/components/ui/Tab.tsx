interface TabProps {
  label: string
  active: boolean
  onClick: () => void
  count?: number
}

export const Tab = ({ label, active, onClick, count }: TabProps) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 400,
      background: active ? 'var(--primary)' : 'transparent',
      color: active ? '#fff' : 'var(--text-2)',
      transition: 'all 0.15s', border: 'none', display: 'flex', alignItems: 'center', gap: 6,
    }}
  >
    {label}
    {count !== undefined && (
      <span style={{
        fontSize: 11, fontWeight: 700,
        background: active ? 'rgba(255,255,255,0.25)' : 'var(--border)',
        color: active ? '#fff' : 'var(--text-3)',
        borderRadius: 99, padding: '1px 6px',
      }}>
        {count}
      </span>
    )}
  </button>
)
