import { useState, useEffect } from 'react'
import { SessionProvider, useSession } from './context/SessionContext'
import { AppDataProvider } from './context/AppDataContext'
import { Sidebar } from './components/layout/Sidebar'
import { LoginWall } from './components/layout/LoginWall'
import { ResetPasswordForm } from './components/layout/ResetPasswordForm'
import { ViewerManagerBar } from './components/layout/ViewerManagerBar'
import { AdminDashboard } from './components/admin/AdminDashboard'
import { ManagerWorkspace } from './components/manager/ManagerWorkspace'
import { History } from './components/history/History'
import { Dashboard } from './components/Dashboard'
import { BroadcastCompose } from './components/BroadcastCompose'
import { Monitor } from './components/Monitor'
import { Integrations } from './components/Integrations'
import { ParticipantPortal } from './components/ParticipantPortal'
import { TweaksPanel, type Tweaks } from './components/TweaksPanel'
import { UI_TOAST_EVENT } from './lib/toast'

const TWEAK_DEFAULTS: Tweaks = {
  accentColor: 'var(--primary)',
  compactDensity: true,
  showOccupancyAlerts: true,
}

const allowedPages = (role: string): string[] => {
  if (role === 'admin')   return ['admin', 'history', 'integrations']
  if (role === 'manager') return ['manager', 'history']
  if (role === 'viewer')  return ['history']
  return []
}

const defaultPageForRole = (role: string) => {
  if (role === 'admin')   return 'admin'
  if (role === 'manager') return 'manager'
  return 'history'
}

type Toast = { id: string; type: string; message: string }

const AppShell = () => {
  const { session, needsPasswordReset } = useSession()
  const [page, setPage] = useState('admin')
  const [tweaks, setTweaks] = useState<Tweaks>(TWEAK_DEFAULTS)
  const [showTweaks, setShowTweaks] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    if (!session || session.role === 'participant') return
    setPage(defaultPageForRole(session.role))
  }, [session])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === '__activate_edit_mode')   setShowTweaks(true)
      if (e.data?.type === '__deactivate_edit_mode') setShowTweaks(false)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail || {}
      if (!d.message) return
      const toast: Toast = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...d }
      setToasts(prev => [...prev, toast])
      const timeout = d.type === 'error' ? 3600 : 2400
      window.setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id))
      }, timeout)
    }
    window.addEventListener(UI_TOAST_EVENT, onToast)
    return () => window.removeEventListener(UI_TOAST_EVENT, onToast)
  }, [])

  const onTweak = (k: keyof Tweaks, v: string | boolean) => {
    const next = { ...tweaks, [k]: v }
    setTweaks(next)
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: next }, '*')
  }

  if (needsPasswordReset) return <ResetPasswordForm />
  if (!session) return <LoginWall />
  if (session.role === 'participant') return <ParticipantPortal />

  const allowed = allowedPages(session.role)
  const navigate = (p: string) => {
    if (allowed.includes(p)) { setPage(p); setSidebarOpen(false) }
  }

  const viewerMid = session.role === 'viewer' ? session.activeManagerId : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', overflow: 'hidden' }}>
      {isMobile && (
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={() => setSidebarOpen(true)}
          style={{ position: 'fixed', top: 8, left: 8, zIndex: 98, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 18, cursor: 'pointer', boxShadow: 'var(--shadow)', lineHeight: 1 }}
        >
          ☰
        </button>
      )}

      <div aria-live="polite" aria-atomic="true" style={{ position: 'fixed', top: 12, right: 12, zIndex: 2600, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none', maxWidth: 360 }}>
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            style={{ pointerEvents: 'auto', background: 'var(--surface)', border: `1px solid ${t.type === 'error' ? 'var(--red)' : 'var(--border-strong)'}`, borderLeft: `4px solid ${t.type === 'error' ? 'var(--red)' : 'var(--green)'}`, boxShadow: 'var(--shadow-strong)', borderRadius: 12, padding: '11px 13px', color: 'var(--text)', fontSize: 13, lineHeight: 1.4 }}
          >
            {t.message}
          </div>
        ))}
      </div>

      <ViewerManagerBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Sidebar
          active={page}
          onNav={navigate}
          allowedPages={allowed}
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main style={{ flex: 1, display: 'flex', overflow: 'auto', background: 'var(--bg)', paddingTop: isMobile ? 44 : 0 }}>
          {session.role === 'admin'   && page === 'admin'      && <AdminDashboard onNav={navigate} />}
          {session.role === 'manager' && page === 'manager'    && <ManagerWorkspace />}
          {page === 'history' && session.role === 'viewer' && (session.viewableManagers ?? []).length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', color: 'var(--text-2)', fontSize: 14, boxShadow: 'var(--shadow)', maxWidth: 440, textAlign: 'center' }}>
                You have no managers assigned. Contact your admin.
              </div>
            </div>
          )}
          {page === 'history' && !(session.role === 'viewer' && (session.viewableManagers ?? []).length === 0) && (
            <History
              managerFilterId={session.role === 'viewer' ? viewerMid : undefined}
              title="Correspondences"
              subtitle={
                session.role === 'viewer'
                  ? 'Threads for the selected manager partition (Admin-assigned).'
                  : session.role === 'manager'
                    ? 'Your partition only.'
                    : undefined
              }
              emptyMessage={
                session.role === 'viewer'
                  ? 'No broadcasts yet for this manager.'
                  : session.role === 'manager'
                    ? 'No broadcasts yet. Use Send now or wait for a scheduled broadcast.'
                    : 'No broadcasts yet. Trigger a report cycle via Send now or a scheduled broadcast.'
              }
            />
          )}
          {page === 'dashboard'   && <Dashboard onNav={navigate} />}
          {page === 'broadcast'   && <BroadcastCompose onSent={() => navigate('monitor')} />}
          {page === 'monitor'     && <Monitor />}
          {page === 'integrations' && session.role === 'admin' && <Integrations />}
        </main>
        <TweaksPanel show={showTweaks} tweaks={tweaks} onTweak={onTweak} />
      </div>
    </div>
  )
}

export const App = () => (
  <SessionProvider>
    <AppDataProvider>
      <AppShell />
    </AppDataProvider>
  </SessionProvider>
)
