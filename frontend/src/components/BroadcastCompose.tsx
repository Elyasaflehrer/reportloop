import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Avatar } from './ui/Avatar'

type Props = { onSent: () => void }

export const BroadcastCompose = ({ onSent }: Props) => {
  const { participants, questions } = useAppData()
  const [selected, setSelected] = useState<number[]>([])
  const [step, setStep] = useState<'compose' | 'confirm' | 'sending' | 'sent'>('compose')
  const [progress, setProgress] = useState(0)

  const toggle = (id: number) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const confirmSend = () => {
    setStep('sending')
    let p = 0
    const iv = setInterval(() => {
      p += 20
      setProgress(p)
      if (p >= 100) { clearInterval(iv); setTimeout(() => setStep('sent'), 400) }
    }, 250)
  }

  if (step === 'sent') return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>✓</div>
      <div style={{ fontWeight: 700, fontSize: 20 }}>Broadcast Sent</div>
      <div style={{ color: 'var(--text-2)' }}>SMS delivered to {selected.length} participant{selected.length !== 1 ? 's' : ''}</div>
      <button onClick={onSent} style={{ marginTop: 8, background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '10px 22px', fontWeight: 600, fontSize: 14 }}>
        Monitor Live Responses →
      </button>
    </div>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px', maxWidth: 780 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>New Broadcast</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>Send a report request via SMS to selected participants.</p>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Report Template</div>
        <div style={{ padding: '14px 16px', borderRadius: 8, border: '2px solid var(--primary)', background: 'var(--primary-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Weekly Operations Report</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{questions.length} question{questions.length !== 1 ? 's' : ''} · ~5 min conversation</div>
          </div>
          <span style={{ color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>✓ Selected</span>
        </div>
        <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 8, background: 'var(--bg)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Questions AI will ask</div>
          {questions.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No questions configured yet. Add questions in Admin first.</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {questions.map(q => (
              <div key={q.id} style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--primary)', fontSize: 10 }}>●</span>{q.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 600 }}>Recipients</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{selected.length} of {participants.length} selected</div>
        </div>
        {participants.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No participants yet. Add participants in Admin first.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {participants.map(p => (
            <button type="button" key={p.id} onClick={() => toggle(p.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8,
              border: `1px solid ${selected.includes(p.id) ? 'var(--primary)' : 'var(--border)'}`,
              background: selected.includes(p.id) ? 'var(--primary-light)' : 'var(--bg)',
              cursor: 'pointer', transition: 'all 0.15s', width: '100%', textAlign: 'left',
            }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selected.includes(p.id) ? 'var(--primary)' : 'var(--border-strong)'}`, background: selected.includes(p.id) ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {selected.includes(p.id) && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
              </div>
              <Avatar initials={(p.name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2)} size={30} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.phone ?? '—'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {step === 'sending' ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Sending SMS messages…</div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--border)' }}>
            <div style={{ height: '100%', borderRadius: 99, background: 'var(--primary)', width: `${progress}%`, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>{Math.round(progress / 100 * selected.length)} of {selected.length} sent</div>
        </div>
      ) : step === 'confirm' ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Confirm broadcast</div>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
            You are about to send SMS messages to <strong>{selected.length} participant{selected.length !== 1 ? 's' : ''}</strong>. This cannot be undone.
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Questions the AI will ask</div>
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {questions.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No questions configured yet.</div>}
            {questions.map((q, i) => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-2)' }}>
                <span style={{ fontWeight: 700, color: 'var(--primary)', flexShrink: 0, minWidth: 16 }}>{i + 1}.</span>
                <span style={{ lineHeight: 1.45 }}>{q.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('compose')} style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, fontWeight: 600, fontSize: 14, background: 'var(--bg)' }}>
              ← Back
            </button>
            <button onClick={confirmSend} style={{ flex: 2, background: 'var(--primary)', color: '#fff', borderRadius: 'var(--radius)', padding: 12, fontWeight: 600, fontSize: 14 }}>
              ↑ Confirm &amp; Send
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setStep('confirm')}
          disabled={selected.length === 0}
          style={{ width: '100%', background: selected.length > 0 ? 'var(--primary)' : 'var(--border)', color: selected.length > 0 ? '#fff' : 'var(--text-3)', borderRadius: 'var(--radius)', padding: 14, fontWeight: 600, fontSize: 15, cursor: selected.length > 0 ? 'pointer' : 'not-allowed' }}
        >
          ↑ Send to {selected.length} Participant{selected.length !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
