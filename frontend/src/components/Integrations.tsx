import { useState, useEffect } from 'react'

const TwilioStatusCard = () => {
  const [status, setStatus] = useState<boolean | null>(null)

  useEffect(() => {
    setStatus(null)
  }, [])

  const webhookUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/webhooks/twilio`
      : '/webhooks/twilio'

  return (
    <div style={{ maxWidth: 560, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '22px 24px', boxShadow: 'var(--shadow)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Twilio</div>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 10px', borderRadius: 99, background: status ? 'var(--green-bg)' : 'var(--border)', color: status ? 'var(--green)' : 'var(--text-3)' }}>
          {status === null ? 'Status pending API' : status ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
        Twilio credentials are set via <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, and <code>TWILIO_FROM_NUMBER</code> environment variables on the server. They are never stored or transmitted through the browser.
      </p>
      <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Webhook URL (configure in Twilio console)</div>
        <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all', color: 'var(--text)' }}>
          {webhookUrl}
        </div>
      </div>
    </div>
  )
}

export const Integrations = () => (
  <div style={{ flex: 1, overflowY: 'auto', padding: '32px 36px' }}>
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Integrations</h1>
      <p style={{ color: 'var(--text-2)', marginTop: 3 }}>
        Integration credentials are configured server-side via environment variables.
      </p>
    </div>
    <TwilioStatusCard />
  </div>
)
