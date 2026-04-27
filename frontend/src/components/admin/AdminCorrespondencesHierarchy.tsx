export const AdminCorrespondencesHierarchy = () => (
  <div style={{ maxWidth: 720 }}>
    <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 16 }}>
      Conversation history will appear here once broadcasts have been sent and participants have responded.
    </p>
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', color: 'var(--text-3)', fontSize: 14 }}>
      No correspondences yet. Trigger a report cycle via Broadcast or Schedule to begin collecting responses.
    </div>
  </div>
)
