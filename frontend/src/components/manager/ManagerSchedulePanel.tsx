import { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { toastSuccess, toastError, confirmDiscardUnsaved } from '../../lib/toast'
import { inputSx } from '../../lib/inputSx'
import { Modal } from '../ui/Modal'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SCHEDULE_TIMEZONES = [
  { label: 'Eastern (ET)',  value: 'America/New_York' },
  { label: 'Central (CT)',  value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)',  value: 'America/Los_Angeles' },
]

type ReviewDraft = {
  label: string; day: string; time: string; timezone: string
  active: boolean; recipientMode: string
  employeeIds: number[]; questionIds: number[]
}

export const ManagerSchedulePanel = () => {
  const { schedules, questions, participants, token, refresh } = useAppData()

  const [showAddModal, setShowAddModal] = useState(false)
  const [label, setLabel] = useState('Weekly send')
  const [day, setDay] = useState('Sunday')
  const [time, setTime] = useState('08:00')
  const [timezone, setTimezone] = useState('America/New_York')
  const [mode, setMode] = useState('all')
  const [subsetIds, setSubsetIds] = useState<number[]>([])
  const [newQIds, setNewQIds] = useState<Set<number>>(() => new Set())
  const [modalQSearch, setModalQSearch] = useState('')
  const [modalEmpSearch, setModalEmpSearch] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null)
  const [saving, setSaving] = useState(false)

  const openAddModal = () => {
    setLabel('Weekly send'); setDay('Sunday'); setTime('08:00')
    setTimezone('America/New_York'); setMode('all'); setSubsetIds([])
    setModalQSearch(''); setModalEmpSearch('')
    setNewQIds(new Set(questions.map(q => q.id)))
    setReviewDraft(null); setShowAddModal(true)
  }

  const buildDraft = (): ReviewDraft | null => {
    if (!String(label || '').trim()) { toastError('Schedule label is required.'); return null }
    const picked = questions.filter(q => newQIds.has(q.id)).map(q => q.id)
    const qids = picked.length ? picked : questions.length ? [questions[0].id] : []
    return { label: String(label || '').trim(), day, time, timezone, active: true, recipientMode: mode, employeeIds: mode === 'subset' ? subsetIds : [], questionIds: qids }
  }

  const confirmAddJob = async () => {
    if (!reviewDraft || saving) return
    setSaving(true)
    try {
      const newSchedule = await apiFetch('/schedules', token, {
        method: 'POST',
        body: { label: reviewDraft.label, dayOfWeek: reviewDraft.day, timeOfDay: reviewDraft.time, timezone: reviewDraft.timezone, recipientMode: reviewDraft.recipientMode, active: true },
      }) as any
      const newId = newSchedule.id
      for (const qid of reviewDraft.questionIds) {
        await apiFetch(`/schedules/${newId}/questions`, token, { method: 'POST', body: { questionId: qid } })
      }
      if (reviewDraft.recipientMode === 'subset') {
        for (const uid of reviewDraft.employeeIds) {
          await apiFetch(`/schedules/${newId}/recipients`, token, { method: 'POST', body: { userId: uid } })
        }
      }
      await refresh()
      setSubsetIds([]); setShowAddModal(false); setReviewDraft(null)
      toastSuccess('Schedule added.')
    } catch (err: any) {
      toastError('Failed to create schedule: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    const target = schedules.find(j => j.id === id)
    if (!target) return
    if (!confirm(`Remove schedule "${target.label}"?`)) return
    setSaving(true)
    try {
      await apiFetch(`/schedules/${id}`, token, { method: 'DELETE' })
      await refresh()
      toastSuccess('Schedule removed.')
    } catch (err: any) {
      toastError('Unexpected error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const patchJob = async (id: number, patch: Record<string, unknown>) => {
    setSaving(true)
    try {
      await apiFetch(`/schedules/${id}`, token, { method: 'PATCH', body: patch })
      await refresh()
      if ('active' in patch) toastSuccess(`Schedule ${patch.active ? 'activated' : 'paused'}.`)
    } catch (err: any) {
      toastError('Failed to update schedule: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleJobQuestion = async (job: any, qid: number) => {
    const cur = new Set(job.questionIds || [])
    setSaving(true)
    try {
      if (cur.has(qid)) {
        await apiFetch(`/schedules/${job.id}/questions/${qid}`, token, { method: 'DELETE' })
      } else {
        await apiFetch(`/schedules/${job.id}/questions`, token, { method: 'POST', body: { questionId: qid } })
      }
      await refresh()
      toastSuccess('Schedule questions updated.')
    } catch (err: any) {
      toastError('Unexpected error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleSubset = (empId: number) =>
    setSubsetIds(s => s.includes(empId) ? s.filter(x => x !== empId) : [...s, empId])

  const toggleNewQuestion = (qid: number) =>
    setNewQIds(prev => { const n = new Set(prev); if (n.has(qid)) n.delete(qid); else n.add(qid); return n })

  const isAddScheduleDirty = () => {
    const desiredDefault = new Set(questions.map(q => q.id))
    const questionDirty = newQIds.size !== desiredDefault.size || [...newQIds].some(id => !desiredDefault.has(id))
    return String(label || '').trim() !== 'Weekly send' || day !== 'Sunday' || time !== '08:00' || mode !== 'all' || subsetIds.length > 0 || questionDirty
  }

  const requestCloseAddSchedule = () => {
    if (isAddScheduleDirty() && !confirmDiscardUnsaved('schedule editor')) return
    setReviewDraft(null); setShowAddModal(false)
  }

  const questionsInModal = questions.filter(q => !modalQSearch.trim() || (q.text || '').toLowerCase().includes(modalQSearch.trim().toLowerCase()))
  const rosterInModal = participants.filter(p => {
    if (!modalEmpSearch.trim()) return true
    const t = modalEmpSearch.trim().toLowerCase()
    return (p.name || '').toLowerCase().includes(t) || String(p.id).includes(t)
  })

  return (
    <div style={{ maxWidth: 720, opacity: saving ? 0.7 : 1, pointerEvents: saving ? 'none' : 'auto' }}>
      <p style={{ color: 'var(--text-2)', marginBottom: 16, fontSize: 14 }}>
        Schedules decide who receives prompts and which questions are asked each cycle.
      </p>
      <div style={{ marginBottom: 20 }}>
        <button type="button" onClick={openAddModal} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '9px 18px', fontWeight: 600 }}>
          Add schedule…
        </button>
      </div>

      {showAddModal && (
        <Modal title="Add schedule" onClose={requestCloseAddSchedule} width={580}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 130px', gap: 10 }}>
              <input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} style={inputSx} />
              <select value={day} onChange={e => setDay(e.target.value)} style={inputSx}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputSx} />
              <select value={timezone} onChange={e => setTimezone(e.target.value)} style={inputSx}>
                {SCHEDULE_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6 }}>Questions to include</div>
              <input placeholder="Search questions…" value={modalQSearch} onChange={e => setModalQSearch(e.target.value)} style={{ ...inputSx, marginBottom: 8 }} />
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {questionsInModal.map(q => (
                  <label key={q.id} style={{ fontSize: 14 }}>
                    <input type="checkbox" checked={newQIds.has(q.id)} onChange={() => toggleNewQuestion(q.id)} /> {q.text}
                  </label>
                ))}
                {questions.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Add questions in the Questions tab first.</span>}
                {questions.length > 0 && questionsInModal.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No questions match search.</span>}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6 }}>Recipients</div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 14 }}><input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> All participants ({participants.length})</label>
                <label style={{ fontSize: 14 }}><input type="radio" checked={mode === 'subset'} onChange={() => setMode('subset')} /> Subset</label>
              </div>
              {mode === 'subset' && (
                <>
                  <input placeholder="Search participants…" value={modalEmpSearch} onChange={e => setModalEmpSearch(e.target.value)} style={{ ...inputSx, marginTop: 10, marginBottom: 8 }} />
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rosterInModal.map(e => (
                      <label key={e.id} style={{ fontSize: 14 }}>
                        <input type="checkbox" checked={subsetIds.includes(e.id)} onChange={() => toggleSubset(e.id)} /> {e.name}
                      </label>
                    ))}
                    {participants.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No participants yet.</span>}
                    {participants.length > 0 && rosterInModal.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No participants match search.</span>}
                  </div>
                </>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
              Scope: <b>{mode === 'all' ? 'All participants' : 'Subset'}</b> · Count: <b>{mode === 'all' ? participants.length : subsetIds.length}</b> · Questions: <b>{newQIds.size}</b>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={requestCloseAddSchedule} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Cancel</button>
              <button type="button" onClick={() => { const d = buildDraft(); if (d) setReviewDraft(d) }} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 600 }}>Review</button>
            </div>
          </div>
        </Modal>
      )}

      {reviewDraft && (
        <Modal title="Review schedule before save" onClose={() => setReviewDraft(null)} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Confirm the details below before saving.</div>
            <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 8, fontSize: 13 }}>
              <div><b>Label:</b> {reviewDraft.label}</div>
              <div><b>When:</b> {reviewDraft.day} @ {reviewDraft.time} ({SCHEDULE_TIMEZONES.find(tz => tz.value === reviewDraft.timezone)?.label ?? reviewDraft.timezone})</div>
              <div><b>Recipients:</b> {reviewDraft.recipientMode === 'all' ? `All participants (${participants.length})` : `Subset (${reviewDraft.employeeIds.length})`}</div>
              <div><b>Questions:</b> {reviewDraft.questionIds.length} selected</div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setReviewDraft(null)} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Back</button>
              <button type="button" onClick={confirmAddJob} disabled={saving} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Confirm and save'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {schedules.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>
            No schedules yet. Click "Add schedule…" to create one.
          </div>
        )}
        {schedules.map(j => {
          const active = j.active !== false
          return (
            <div key={j.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <b>{j.label}</b>
                {!active && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', borderRadius: 99, padding: '2px 7px', background: 'var(--border)', color: 'var(--text-3)' }}>Paused</span>}
                <span style={{ color: 'var(--text-3)' }}>{j.dayOfWeek} @ {j.timeOfDay}</span>
                <span style={{ color: 'var(--text-3)' }}>· {j.recipientMode === 'all' ? 'all participants' : `subset (${((j as any).employeeIds || []).length})`}</span>
                <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={active} onChange={() => patchJob(j.id, { active: !active })} /> Active
                </label>
                <button type="button" onClick={() => remove(j.id)} style={{ color: 'var(--red)', fontWeight: 600 }}>Remove</button>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Questions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {questions.map(q => (
                  <label key={q.id} style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={((j as any).questionIds || []).includes(q.id)} onChange={() => toggleJobQuestion(j, q.id)} /> {q.text}
                  </label>
                ))}
                {questions.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No questions configured.</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
