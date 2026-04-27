import { useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { apiFetch } from '../../lib/apiFetch'
import { toastSuccess, toastError, confirmDiscardUnsaved } from '../../lib/toast'
import { inputSx } from '../../lib/inputSx'
import { Modal } from '../ui/Modal'

type EditQuestion = { id: number; text: string; __baselineText: string }

export const ManagerQuestionsPanel = () => {
  const { questions, token, refresh } = useAppData()
  const [text,    setText]   = useState('')
  const [edit,    setEdit]   = useState<EditQuestion | null>(null)
  const [qSearch, setQSearch] = useState('')
  const [saving,  setSaving] = useState(false)

  const add = async () => {
    if (!text.trim()) { toastError('Question text is required.'); return }
    setSaving(true)
    try {
      await apiFetch('/questions', token, { method: 'POST', body: { text: text.trim() } })
      await refresh()
      setText('')
      toastSuccess('Question added.')
    } catch (err: any) {
      toastError(`Could not add question: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    setSaving(true)
    try {
      await apiFetch(`/questions/${id}`, token, { method: 'DELETE' })
      await refresh()
      toastSuccess('Question removed.')
    } catch (err: any) {
      toastError(`Could not remove question: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!edit?.text.trim()) { toastError('Could not save question: text is required.'); return }
    setSaving(true)
    try {
      await apiFetch(`/questions/${edit.id}`, token, { method: 'PATCH', body: { text: edit.text.trim() } })
      await refresh()
      setEdit(null)
      toastSuccess('Question updated.')
    } catch (err: any) {
      toastError(`Could not save question: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const filteredList = questions.filter(q =>
    !qSearch.trim() || (q.text || '').toLowerCase().includes(qSearch.trim().toLowerCase())
  )

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-3)' }}>
        {questions.length} question{questions.length !== 1 ? 's' : ''} · All optional
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input placeholder="New question text" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} style={inputSx} />
        <button type="button" onClick={add} disabled={saving}
          style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '0 16px', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          Add
        </button>
      </div>
      <input placeholder="Search questions…" value={qSearch} onChange={e => setQSearch(e.target.value)} style={{ ...inputSx, marginBottom: 10 }} />
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 480, overflowY: 'auto' }}>
        {filteredList.map(q => (
          <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
            <span>{q.text}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setEdit({ id: q.id, text: q.text, __baselineText: q.text })} style={{ fontWeight: 600, color: 'var(--primary)', fontSize: 13 }}>Edit</button>
              <button type="button" onClick={() => remove(q.id)} disabled={saving} style={{ color: 'var(--red)', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>Remove</button>
            </div>
          </div>
        ))}
        {filteredList.length === 0 && (
          <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 14 }}>
            {questions.length === 0 ? 'No questions yet — add your first question above.' : 'No questions match.'}
          </div>
        )}
      </div>

      {edit && (
        <Modal
          title="Edit question"
          onClose={() => {
            const dirty = edit.text.trim() !== edit.__baselineText.trim()
            if (dirty && !confirmDiscardUnsaved('question editor')) return
            setEdit(null)
          }}
          width={440}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea value={edit.text} onChange={e => setEdit(x => x ? { ...x, text: e.target.value } : x)}
              rows={3} style={{ ...inputSx, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEdit(null)} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px' }}>Cancel</button>
              <button type="button" onClick={saveEdit} disabled={saving} style={{ background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
