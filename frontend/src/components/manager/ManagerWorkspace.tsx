import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { toastSuccess, toastError } from '../../lib/toast'
import { Tab } from '../ui/Tab'
import { ManagerQuestionsPanel } from './ManagerQuestionsPanel'
import { ManagerSchedulePanel } from './ManagerSchedulePanel'
import { ManagerParticipantsPanel } from './ManagerParticipantsPanel'
import { History } from '../history/History'

export const ManagerWorkspace = () => {
  const [tab, setTab] = useState('questions')
  const { session, setAssignedPhone } = useSession()
  const [provisioning, setProvisioning] = useState(false)

  const isManager = session?.role === 'manager'
  const assignedPhone = session?.assignedPhone ?? null

  const requestNumber = async () => {
    if (!session?.userId) {
      toastError('Could not assign number: missing user id in session.')
      return
    }
    setProvisioning(true)
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL as string
      const res = await fetch(`${apiBase}/users/${session.userId}/provision-number`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.error === 'PHONE_LIMIT_REACHED') {
          toastError('No numbers available. Contact your admin.')
        } else if (data.error === 'PROVISION_FAILED') {
          toastError('Could not assign a number. Try again.')
        } else {
          toastError(`Could not assign number: ${data.error || `Request failed ${res.status}`}`)
        }
        return
      }
      // Update session in place — header re-renders, schedule activation guards lift
      setAssignedPhone(String(data.assignedPhone))
      toastSuccess(`Phone number assigned: ${data.assignedPhone}`)
    } catch (err: any) {
      toastError(`Could not assign number: ${err.message}`)
    } finally {
      setProvisioning(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Manager workspace</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>
          Questions, schedules, and correspondences for properties Admin assigned to you.
        </p>
      </div>

      {/* Phone-number status banner — managers only */}
      {isManager && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: assignedPhone ? 'var(--surface)' : 'oklch(97% 0.02 70)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {assignedPhone ? (
            <span style={{ fontSize: 14 }}>
              <span style={{ color: 'var(--text-2)' }}>Your number:</span>{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{assignedPhone}</span>
            </span>
          ) : (
            <>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text-1)' }}>No phone number assigned.</strong>{' '}
                You need a number before you can send broadcasts or activate schedules.
              </span>
              <button
                type="button"
                onClick={requestNumber}
                disabled={provisioning}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--primary)',
                  border: '1px solid var(--primary)',
                  background: 'var(--primary-light)',
                  borderRadius: 6,
                  padding: '6px 14px',
                  opacity: provisioning ? 0.5 : 1,
                  cursor: provisioning ? 'not-allowed' : 'pointer',
                }}
              >
                {provisioning ? 'Requesting…' : 'Request phone number'}
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content', boxShadow: 'var(--shadow)' }}>
        <Tab label="Questions"      active={tab === 'questions'}    onClick={() => setTab('questions')} />
        <Tab label="Schedule"       active={tab === 'schedule'}     onClick={() => setTab('schedule')} />
        <Tab label="Participants"   active={tab === 'participants'}  onClick={() => setTab('participants')} />
        <Tab label="Correspondences"active={tab === 'corr'}         onClick={() => setTab('corr')} />
      </div>

      {tab === 'questions'   && <ManagerQuestionsPanel />}
      {tab === 'schedule'    && <ManagerSchedulePanel />}
      {tab === 'participants'&& <ManagerParticipantsPanel />}
      {tab === 'corr' && (
        <History
          title="Correspondences"
          subtitle="Threads for properties under your manager partition only."
          emptyMessage="No broadcasts yet. Use Send now or wait for a scheduled broadcast."
        />
      )}
    </div>
  )
}
