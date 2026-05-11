// Test-only helpers for the in-memory mock SMS provider's inspection API.
// Only works when the backend was started with SMS_PROVIDER=mock — those
// routes (_test/sms-log) are not registered in any other configuration.
// See backend/docs/mock-sms-provider.md.

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8082'

export type ProvisionNumberCall = {
  kind:             'provisionNumber'
  country:          string
  numberType:       string
  webhookUrl:       string
  assignedPhone:    string
  assignedPhoneSid: string
  at:               string
}

export type SendSmsCall = {
  kind:      'sendSms'
  to:        string
  body:      string
  from:      string
  messageId: string
  at:        string
}

export type MockSmsCall = ProvisionNumberCall | SendSmsCall

export async function getSmsLog(): Promise<MockSmsCall[]> {
  const res = await fetch(`${BACKEND_URL}/_test/sms-log`)
  if (!res.ok) {
    throw new Error(
      `getSmsLog: GET /_test/sms-log returned ${res.status}. ` +
      `Backend must be started with SMS_PROVIDER=mock.`,
    )
  }
  return res.json() as Promise<MockSmsCall[]>
}

export async function clearSmsLog(): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/_test/sms-log`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(
      `clearSmsLog: DELETE /_test/sms-log returned ${res.status}. ` +
      `Backend must be started with SMS_PROVIDER=mock.`,
    )
  }
}

// Polls the call log until a matching entry appears, or throws on timeout.
// Needed because provisionNumber / sendSms are fired async from request
// handlers (e.g. `void onManagerCreated(...)` in users.ts) — the HTTP
// response returns before the provider call lands.
export async function waitForSmsCall(
  predicate: (call: MockSmsCall) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MockSmsCall> {
  const { timeoutMs = 2000, intervalMs = 50 } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const log = await getSmsLog()
    const match = log.find(predicate)
    if (match) return match
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  const finalLog = await getSmsLog()
  throw new Error(
    `waitForSmsCall: no matching call within ${timeoutMs}ms. ` +
    `Log: ${JSON.stringify(finalLog)}`,
  )
}
