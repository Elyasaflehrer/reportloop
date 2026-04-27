export type Tweaks = {
  accentColor: string
  compactDensity: boolean
  showOccupancyAlerts: boolean
}

type Props = {
  show: boolean
  tweaks: Tweaks
  onTweak: (key: keyof Tweaks, value: string | boolean) => void
}

export const TweaksPanel = ({ show, tweaks, onTweak }: Props) => {
  if (!show) return null

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, width: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 32px oklch(0% 0 0/0.12)', padding: 16, zIndex: 1000 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Tweaks</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text-2)' }}>Accent Color</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['var(--primary)', 'oklch(28% 0.08 160)', 'oklch(28% 0.08 30)'].map((c, i) => (
              <button
                type="button" key={i} onClick={() => onTweak('accentColor', c)}
                aria-label={`Set accent color option ${i + 1}`}
                style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: 'pointer', border: `2px solid ${tweaks.accentColor === c ? '#000' : 'transparent'}` }}
              />
            ))}
          </div>
        </div>
        {(['compactDensity', 'showOccupancyAlerts'] as const).map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>
              {key === 'compactDensity' ? 'Compact density' : 'Occupancy alerts'}
            </div>
            <button
              type="button" role="switch"
              aria-label={`Toggle ${key === 'compactDensity' ? 'compact density' : 'occupancy alerts'}`}
              aria-checked={!!tweaks[key]}
              onClick={() => onTweak(key, !tweaks[key])}
              style={{ width: 36, height: 20, borderRadius: 99, background: tweaks[key] ? 'var(--green)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}
            >
              <div style={{ position: 'absolute', top: 2, left: tweaks[key] ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px oklch(0% 0 0/0.2)' }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
