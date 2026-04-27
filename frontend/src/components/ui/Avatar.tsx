interface AvatarProps {
  initials: string
  size?: number
  color?: 'primary' | 'green' | 'amber' | 'red' | 'blue'
}

const colors = {
  primary: { bg: 'var(--primary)',    text: '#fff' },
  green:   { bg: 'var(--green-bg)',   text: 'var(--green)' },
  amber:   { bg: 'var(--amber-bg)',   text: 'var(--amber)' },
  red:     { bg: 'var(--red-bg)',     text: 'var(--red)' },
  blue:    { bg: 'var(--blue-bg)',    text: 'var(--blue)' },
}

export const Avatar = ({ initials, size = 32, color = 'primary' }: AvatarProps) => {
  const c = colors[color] ?? colors.primary
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: c.bg, color: c.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 600, flexShrink: 0, letterSpacing: '0.02em',
    }}>
      {initials}
    </div>
  )
}
