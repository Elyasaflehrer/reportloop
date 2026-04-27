import { useState, useEffect, useCallback } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { LogModal, type ConversationLog } from './LogModal'
import { StatusPill } from '../ui/StatusPill'

type BroadcastStats = {
  total: number; completed: number; failed: number; awaiting_reply: number; pending: number
}

type Broadcast = {
  id:            number
  scheduleId:    number
  scheduleLabel: string | null
  fireDate:      string
  status:        string
  triggeredAt:   string
  stats:         BroadcastStats
}

type ConversationRow = {
  id:            number
  userId:        number
  userName:      string
  userPhone:     string | null
  status:        string
  startedAt:     string | null
  completedAt:   string | null
  lastMessageAt: string | null
  failReason:    string | null
}

type ConversationDetail = {
  id:          number
  userId:      number
  userName:    string
  status:      string
  startedAt:   string | null
  completedAt: string | null
  failReason:  string | null
  messages:    { role: 'ai' | 'participant'; body: string; sentAt: string }[]
  answers:     { questionId: number; questionText: string; answer: string }[]
}

type Props = {
  managerFilterId?: string | number | null
  title?: string
  subtitle?: string
  participantEmployeeId?: number | null
}

const statusLabel = (status: string) => {
  if (status === 'completed')      return 'completed'
  if (status === 'failed')         return 'failed'
  if (status === 'timed_out')      return 'failed'
  if (status === 'awaiting_reply') return 'in-progress'
  return 'pending'
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const History = ({ title, subtitle, participantEmployeeId }: Props) => {
  const { token } = useAppData()

  const [broadcasts,  setBroadcasts]  = useState<Broadcast[]>([])
  const [loading,     setLoading]     = useState(true)
  const [expanded,    setExpanded]    = useState<number | null>(null)
  const [convRows,    setConvRows]    = useState<Record<number, ConversationRow[]>>({})
  const [convLoading, setConvLoading] = useState<number | null>(null)
  const [logModal,    setLogModal]    = useState<ConversationLog | null>(null)

  const loadBroadcasts = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await apiFetch('/broadcasts?limit=50', token) as any
      setBroadcasts(res?.data ?? [])
    } catch {
      setBroadcasts([])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { loadBroadcasts() }, [loadBroadcasts])

  const toggleExpand = async (broadcastId: number) => {
    if (expanded === broadcastId) { setExpanded(null); return }
    setExpanded(broadcastId)
    if (convRows[broadcastId]) return
    setConvLoading(broadcastId)
    try {
      const res = await apiFetch(`/broadcasts/${broadcastId}/conversations`, token) as any
      setConvRows(prev => ({ ...prev, [broadcastId]: res?.data ?? [] }))
    } finally {
      setConvLoading(null)
    }
  }

  const openConversation = async (conv: ConversationRow, fireDate: string) => {
    const detail = await apiFetch(`/conversations/${conv.id}`, token) as ConversationDetail
    const log: ConversationLog = {
      employee: detail.userName,
      property: `Conversation #${detail.id}`,
      date:     fmtDate(detail.startedAt ?? fireDate),
      status:   statusLabel(detail.status) as ConversationLog['status'],
      analysis: detail.answers.map(a => ({ q: a.questionText, a: a.answer })),
      messages: detail.messages.map(m => ({ role: m.role, text: m.body })),
    }
    setLogModal(log)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{title ?? 'Report History'}</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>
          {subtitle ?? 'Full conversation logs stored for tracking and auditing.'}
        </p>
      </div>

      {loading && (
        <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Loading…</div>
      )}

      {!loading && broadcasts.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', color: 'var(--text-2)', fontSize: 14, boxShadow: 'var(--shadow)' }}>
          {participantEmployeeId != null
            ? 'No correspondences yet. Your weekly reports will appear here after the first one has started.'
            : 'No broadcasts yet. Trigger a report cycle via Send now or a scheduled broadcast.'}
        </div>
      )}

      {!loading && broadcasts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {broadcasts.map(b => {
            const isOpen = expanded === b.id
            const rows   = convRows[b.id] ?? []
            const label  = b.scheduleLabel ?? `Schedule #${b.scheduleId}`

            return (
              <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {/* Broadcast header row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(b.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 14, color: 'var(--text-3)', transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s', width: 14, flexShrink: 0 }}>▶</span>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{fmtDate(b.triggeredAt)} · {b.fireDate}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, color: 'var(--text-2)' }}>
                    <span>{b.stats.completed}/{b.stats.total} completed</span>
                    {b.stats.failed > 0 && <span style={{ color: 'var(--red)' }}>{b.stats.failed} failed</span>}
                    {b.stats.awaiting_reply > 0 && <span style={{ color: 'var(--amber)' }}>{b.stats.awaiting_reply} pending reply</span>}
                  </div>

                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: b.status === 'completed' ? 'var(--green-bg)' : b.status === 'failed' ? 'var(--red-bg)' : 'var(--amber-bg)',
                    color:      b.status === 'completed' ? 'var(--green)'    : b.status === 'failed' ? 'var(--red)'    : 'var(--amber)',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>
                    {b.status.replace('_', ' ')}
                  </span>
                </button>

                {/* Expanded conversations */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                    {convLoading === b.id && (
                      <div style={{ padding: '14px 24px', fontSize: 13, color: 'var(--text-3)' }}>Loading conversations…</div>
                    )}

                    {convLoading !== b.id && rows.length === 0 && (
                      <div style={{ padding: '14px 24px', fontSize: 13, color: 'var(--text-3)' }}>No conversations in this broadcast.</div>
                    )}

                    {convLoading !== b.id && rows.map((c, i) => (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '11px 24px',
                          borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                        onClick={() => openConversation(c, b.fireDate)}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                          {c.userName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.userName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                            {c.userPhone ?? '—'}
                            {c.failReason && ` · ${c.failReason}`}
                          </div>
                        </div>

                        <StatusPill status={statusLabel(c.status) as any} />

                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>View →</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {logModal && <LogModal log={logModal} onClose={() => setLogModal(null)} />}
    </div>
  )
}
