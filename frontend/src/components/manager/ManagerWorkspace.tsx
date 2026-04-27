import { useState } from 'react'
import { useSession } from '../../context/SessionContext'
import { Tab } from '../ui/Tab'
import { ManagerQuestionsPanel } from './ManagerQuestionsPanel'
import { ManagerSchedulePanel } from './ManagerSchedulePanel'
import { ManagerParticipantsPanel } from './ManagerParticipantsPanel'
import { History } from '../history/History'

export const ManagerWorkspace = () => {
  const { session } = useSession()
  const mid = session!.id
  const [tab, setTab] = useState('questions')

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Manager workspace</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>
          Questions, schedules, and correspondences for properties Admin assigned to you.
        </p>
      </div>

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
          managerFilterId={mid}
          title="Correspondences"
          subtitle="Threads for properties under your manager partition only."
        />
      )}
    </div>
  )
}
