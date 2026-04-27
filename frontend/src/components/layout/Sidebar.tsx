import { useState, useEffect, useRef } from 'react'
import { useSession } from '../../context/SessionContext'
import { Avatar } from '../ui/Avatar'

interface SidebarProps {
  active: string
  onNav: (page: string) => void
  allowedPages?: string[]
  isMobile?: boolean
  isOpen?: boolean
  onClose?: () => void
}

export const Sidebar = ({
  active, onNav, allowedPages = [], isMobile = false, isOpen = false, onClose = () => {},
}: SidebarProps) => {
  const { session, logout } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const nav: { id: string; icon: string; label: string }[] = []
  if (allowedPages.includes('admin'))    nav.push({ id: 'admin',    icon: 'A', label: 'Admin' })
  if (allowedPages.includes('manager'))  nav.push({ id: 'manager',  icon: 'M', label: 'Manager' })
  if (allowedPages.includes('history'))  nav.push({ id: 'history',  icon: '≡', label: 'Correspondences' })
  if (allowedPages.includes('dashboard'))nav.push({ id: 'dashboard',icon: '▣', label: 'Dashboard' })
  if (allowedPages.includes('broadcast'))nav.push({ id: 'broadcast',icon: '✉', label: 'Broadcast' })
  if (allowedPages.includes('monitor'))  nav.push({ id: 'monitor',  icon: '◎', label: 'Monitor' })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      {isMobile && isOpen && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'oklch(0% 0 0/0.4)', zIndex: 99 }} aria-hidden="true" />
      )}
      <aside style={{
        width: 'var(--sidebar-w)', flexShrink: 0, background: 'var(--surface)',
        borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        padding: '0', overflow: 'visible', minHeight: 0,
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100,
          transform: isOpen ? 'translateX(0)' : 'translateX(-110%)',
          transition: 'transform 0.25s ease',
          boxShadow: isOpen ? 'var(--shadow-strong)' : 'none',
        } : { height: '100%', zIndex: 5 }),
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>A</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>AI Reporter</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>Hotel Operations</div>
            </div>
          </div>
        </div>

        {/* User menu */}
        <div ref={menuRef} style={{ position: 'relative', borderBottom: '1px solid var(--border)', flexShrink: 0, zIndex: 20 }}>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 10, right: 10,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 8px 24px oklch(0% 0 0/0.18)', overflow: 'hidden', zIndex: 200,
            }}>
              {session?.role === 'admin' && (
                <button onClick={() => { onNav('integrations'); setMenuOpen(false) }} style={{
                  width: '100%', textAlign: 'left', padding: '11px 14px', fontSize: 14, fontWeight: 500,
                  color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.12s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15 }}>◈</span> Integrations
                </button>
              )}
              <div style={{ height: 1, background: 'var(--border)', margin: '0 10px' }} />
              <button onClick={() => { logout(); setMenuOpen(false) }} style={{
                width: '100%', textAlign: 'left', padding: '11px 14px', fontSize: 14, fontWeight: 500,
                color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.12s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15 }}>→</span> Log out
              </button>
            </div>
          )}

          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open account menu"
            onClick={() => setMenuOpen(o => !o)}
            style={{
              padding: '12px 14px', width: '100%', textAlign: 'left',
              background: menuOpen ? 'var(--primary-light)' : 'var(--bg)', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!menuOpen) e.currentTarget.style.background = 'oklch(96% 0.01 240)' }}
            onMouseLeave={e => { if (!menuOpen) e.currentTarget.style.background = 'var(--bg)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar initials={session?.initials ?? '??'} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>
                  {session?.name ?? 'User'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500, marginTop: 2 }}>
                  {session?.title || session?.role}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 700, display: 'inline-block', transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
            </div>
          </button>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, minHeight: 0, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {nav.map(item => (
            <button key={item.id} onClick={() => { onNav(item.id); if (isMobile) onClose() }} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
              background: active === item.id ? 'var(--primary-light)' : 'transparent',
              color: active === item.id ? 'var(--primary)' : 'var(--text-2)',
              fontWeight: active === item.id ? 600 : 400,
              fontSize: 14, transition: 'all 0.15s', textAlign: 'left', width: '100%',
            }}>
              <span style={{ fontSize: 15, opacity: 0.85 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
    </>
  )
}
