import { useState } from 'react'
import { LogModal, type ConversationLog } from './LogModal'

type Props = {
  managerFilterId?: string | number | null
  title?: string
  subtitle?: string
  participantEmployeeId?: number | null
  defaultExpandedBroadcastId?: number | null
}

// No broadcasts yet — GET /broadcasts not implemented (see version-2.md)
const BROADCASTS: never[] = []

export const History = ({ managerFilterId, title, subtitle, participantEmployeeId }: Props) => {
  const [logModal, setLogModal] = useState<ConversationLog | null>(null)
  const historyScoped = participantEmployeeId != null || managerFilterId != null

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>{title ?? 'Report History'}</h1>
        <p style={{ color: 'var(--text-2)', marginTop: 3 }}>
          {subtitle ?? 'Full conversation logs stored for tracking and auditing.'}
        </p>
      </div>

      {BROADCASTS.length === 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', color: 'var(--text-2)', fontSize: 14, boxShadow: 'var(--shadow)' }}>
          {historyScoped
            ? participantEmployeeId != null
              ? 'No correspondences yet. Your weekly reports will appear here after the first one has started.'
              : 'No correspondences yet. Next step: in Admin, assign users/contacts to groups and link those groups to a manager.'
            : 'No broadcasts to show.'}
        </div>
      )}

      {logModal && <LogModal log={logModal} onClose={() => setLogModal(null)} />}
    </div>
  )
}
