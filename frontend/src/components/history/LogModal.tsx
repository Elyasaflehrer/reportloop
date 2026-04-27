import { useState, useRef, useEffect } from 'react'
import { Avatar } from '../ui/Avatar'
import { StatusPill } from '../ui/StatusPill'

export type LogAnalysisItem = { q: string; a: string; flag?: 'red' | 'amber' | null }
export type LogMessage = { role: 'ai' | 'participant'; text: string }

export type ConversationLog = {
  employee: string
  property: string
  date: string
  status?: 'completed' | 'in-progress' | 'pending'
  analysis: LogAnalysisItem[]
  messages: LogMessage[]
}

type Props = {
  log: ConversationLog
  onClose: () => void
}

export const LogModal = ({ log, onClose }: Props) => {
  const [view, setView] = useState<'analysis' | 'transcript'>('analysis')
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view === 'transcript' && chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [view])

  const flagColor = (f?: string | null) =>
    f === 'red' ? 'var(--red)' : f === 'amber' ? 'var(--amber)' : null
  const flagBg = (f?: string | null) =>
    f === 'red' ? 'var(--red-bg)' : f === 'amber' ? 'var(--amber-bg)' : 'var(--bg)'

  const initials = log.employee.split(' ').map(w => w[0]).join('')
  const status = log.status ?? 'completed'

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'oklch(0% 0 0/0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: 'min(860px,95vw)', height: 'min(680px,90vh)', background: 'var(--surface)', borderRadius: 14, boxShadow: '0 24px 60px oklch(0% 0 0/0.22)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <Avatar initials={initials} size={38} color={status === 'completed' ? 'green' : 'amber' as const} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{log.employee}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{log.property} · {log.date}</div>
          </div>
          <StatusPill status={status} />
          <button type="button" aria-label="Close log dialog" onClick={onClose} style={{ fontSize: 20, color: 'var(--text-3)', padding: '4px 8px', marginLeft: 8 }}>×</button>
        </div>

        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 6, background: 'var(--bg)' }}>
          {(['analysis', 'transcript'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 13,
              fontWeight: view === v ? 600 : 400,
              background: view === v ? 'var(--primary)' : 'transparent',
              color: view === v ? '#fff' : 'var(--text-2)',
              transition: 'all 0.15s', border: 'none',
            }}>
              {v === 'analysis' ? 'AI Analysis' : 'Full Transcript'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} ref={chatRef}>
          {view === 'analysis' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>AI extracted answers from the conversation for each question</div>
              {log.analysis.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No analysis available.</div>
              )}
              {log.analysis.map((item, i) => (
                <div key={i} style={{
                  borderRadius: 9,
                  border: `1px solid ${item.flag ? `oklch(88% 0.06 ${item.flag === 'red' ? '22' : '68'})` : 'var(--border)'}`,
                  background: flagBg(item.flag),
                  overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 10, fontWeight: 700, color: 'var(--primary)' }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, fontWeight: 500 }}>{item.q}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: flagColor(item.flag) ?? 'var(--text)' }}>{item.a}</div>
                    </div>
                    {item.flag && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: flagColor(item.flag) ?? undefined, background: '#fff', border: `1px solid ${flagColor(item.flag)}`, borderRadius: 99, padding: '2px 8px', flexShrink: 0, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {item.flag === 'red' ? 'Alert' : 'Note'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'transcript' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {log.messages.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages available.</div>
              )}
              {log.messages.map((m, i) => {
                const isAI = m.role === 'ai'
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: isAI ? 'row' : 'row-reverse', gap: 10, alignItems: 'flex-end' }}>
                    {isAI && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
                        <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>A</span>
                      </div>
                    )}
                    <div style={{ maxWidth: '72%' }}>
                      {isAI && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 500 }}>AI Reporter</div>}
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: isAI ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                        background: isAI ? 'var(--bg)' : 'var(--primary)',
                        color: isAI ? 'var(--text)' : '#fff',
                        border: isAI ? '1px solid var(--border)' : 'none',
                        fontSize: 14, lineHeight: 1.5,
                      }}>
                        {m.text}
                      </div>
                    </div>
                    {!isAI && (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
                        <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>{initials}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {status === 'completed' && (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <span style={{ background: 'var(--green-bg)', color: 'var(--green)', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 99 }}>
                    ✓ Report Complete
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
