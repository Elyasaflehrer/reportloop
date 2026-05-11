# Adding a New SMS Provider

The SMS layer uses an interface + adapter + factory pattern. Adding a new provider
(Vonage, Plivo, AWS SNS, etc.) requires changes in exactly 4 places and zero
changes to any route, worker, or business logic.

---

## Architecture overview

```
broadcast.service.ts    ─┐
conversation.worker.ts  ─┤
webhooks.ts             ─┼──▶  ISmsProvider  ──▶  TwilioProvider   (today)
phone-number.service.ts ─┘                    ──▶  VonageProvider   (future)
```

The rest of the app calls `sendSms()`, `provisionNumber()`,
`validateWebhookSignature()`, and `parseInboundWebhook()` on the active
provider instance. It never imports a provider directly.

---

## Step-by-step checklist

### 1. Add env vars to `.env.example`

Two parts: the dispatcher var that selects the provider, and the provider's
own credentials. Follow the naming convention `{PROVIDER}_{VAR}` for creds:

```bash
# Selects which provider the factory builds. Default is 'twilio'.
SMS_PROVIDER=vonage

# Vonage credentials (only read when SMS_PROVIDER=vonage)
VONAGE_API_KEY=
VONAGE_API_SECRET=
```

Don't add a `*_FROM_NUMBER` env var — each manager has their own provisioned
number stored on the `User` row (`assignedPhone`), so the "from" is passed in
per call. Provider creds only.

### 2. Wire the provider into `src/config.ts`

This is **four** edits, not one. Skipping any of them produces a confusing
runtime error — most often a Zod parse failure at boot when `SMS_PROVIDER`
is set to a value not yet in the enum.

**2a. Extend the `smsProvider` enum.**
```typescript
smsProvider: z.enum(['twilio', 'vonage']).default('twilio'),
```

**2b. Add the provider's config block alongside the existing `twilio` block.**
Use `min(1)` on each field so partial creds fail fast, and keep the block
`.nullable().default(null)` so the app boots without it:
```typescript
vonage: z.object({
  apiKey:    z.string().min(1),
  apiSecret: z.string().min(1),
}).nullable().default(null),
```

**2c. Add a conditional mapping in the `parse({ ... })` call**, mirroring the
existing `twilioConfigured` pattern. Define the boolean near the existing one,
then map env vars only when all required creds are present:
```typescript
const vonageConfigured =
  process.env.VONAGE_API_KEY &&
  process.env.VONAGE_API_SECRET

// ...inside schema.parse({ ... }):
vonage: vonageConfigured ? {
  apiKey:    process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
} : null,
```

Don't fall back to `''` for missing values — `min(1)` will reject the empty
string and crash at boot. The whole point of `.nullable()` is to let the
provider stay un-configured.

**2d. Add a "provider selected but not configured" warning.** After the
`schema.parse({ ... })` block at the bottom of `config.ts`, there's a series
of `console.warn` calls — one per provider. Add one for yours, mirroring the
Twilio pattern:
```typescript
if (config.smsProvider === 'vonage' && !config.vonage) {
  console.warn(
    '[config] Vonage not configured — SMS features disabled. ' +
    'Set VONAGE_API_KEY and VONAGE_API_SECRET to enable.'
  )
}
```
The condition is provider-pair-specific: only warn when *this* provider was
selected (`config.smsProvider === '<name>'`) **and** its creds are missing.
Don't write `if (!config.vonage)` — that would fire even when Twilio is the
selected provider, producing false-alarm noise. Each provider's warning
should care only about its own selection state.

Implement all four methods of `ISmsProvider`. Take the config block in the
constructor (typed as `NonNullable<typeof config.vonage>`) — the factory
guarantees it's non-null before constructing.

```typescript
import type { FastifyRequest } from 'fastify'
import type { ISmsProvider, InboundSmsPayload } from '../sms.provider.interface.js'
import { config } from '../../../config.js'

export class VonageProvider implements ISmsProvider {

  constructor(private readonly cfg: NonNullable<typeof config.vonage>) {
    // Initialize the provider's SDK client here.
  }

  async provisionNumber(params: {
    webhookUrl: string
    country:    string
    numberType: string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }> {
    // Search the provider's inventory for an available number matching
    // (country, numberType), purchase it, and configure its inbound-SMS
    // callback to params.webhookUrl. Return the E.164 number and the
    // provider's SID for that number — both are stored on the manager's
    // User row (assignedPhone, assignedPhoneSid).
    // Throw on failure; the caller wraps the error in ProvisionFailedError.
  }

  async sendSms(to: string, body: string, from: string): Promise<string> {
    // Send via the provider's SDK using `from` as the sender (each manager
    // has their own provisioned number — never read a global from-number
    // from config). Return the provider's message ID. Throw a domain error
    // (not the raw SDK error) on failure.
  }

  validateWebhookSignature(req: FastifyRequest): boolean {
    // Verify the request genuinely came from Vonage.
    // Return false if signature is invalid — never throw here.
  }

  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload {
    // Map Vonage's webhook body to the common InboundSmsPayload shape.
    // Vonage posts: { msisdn, to, text, messageId }
    // `to` is the manager's number on this account — required for routing
    // the inbound to the correct manager.
    const body = req.body as Record<string, string>
    return {
      from:      body.msisdn,
      to:        body.to,
      body:      body.text,
      messageId: body.messageId,
    }
  }
}
```

### 4. Register the provider in `src/services/sms/sms.factory.ts`

Add one `case` to the switch:

```typescript
case 'vonage':
  if (!config.vonage) throw new Error('SMS_PROVIDER=vonage but VONAGE_API_KEY is not set')
  return new VonageProvider(config.vonage)
```

---

## The ISmsProvider interface

Every provider must implement exactly these four methods:

```typescript
interface ISmsProvider {
  sendSms(to: string, body: string, from: string): Promise<string>
  provisionNumber(params: {
    webhookUrl: string
    country:    string
    numberType: string
  }): Promise<{ assignedPhone: string; assignedPhoneSid: string }>
  validateWebhookSignature(req: FastifyRequest): boolean
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload
}

type InboundSmsPayload = {
  from:      string  // participant's phone (E.164) — the `From` on the inbound
  to:        string  // manager's number (E.164) — the `To`; used to route the reply
  body:      string  // raw message text from the participant
  messageId: string  // provider's unique message ID (used as idempotency key)
}
```

### `sendSms(to, body, from)`
- `to`: participant's phone, E.164
- `body`: pre-built SMS text from `sms.service.ts`
- `from`: the manager's assigned number, E.164 — each manager has their own
  provisioned number, so the caller passes it in (see `phone-number.service.ts`)
- Returns: provider's message ID (stored as `Message.twilioSid` for idempotency)
- Must set a status/delivery callback URL so failed deliveries are reported back
- Must throw a domain-level error (`SmsDeliveryError`) — never let the raw SDK error bubble up

### `provisionNumber({ webhookUrl, country, numberType })`
- Called by `phone-number.service.ts` when a manager is created (or promoted)
  and no idle number is available to recycle
- `webhookUrl`: the SMS-receive callback the provider should POST inbound
  messages to (today: `${APP_BASE_URL}/webhooks/twilio`)
- `country`: ISO country code, e.g. `US`
- `numberType`: provider-specific category, e.g. `local`, `mobile`, `tollFree`
- Returns: the purchased phone (E.164) plus the provider's SID for that number,
  both stored on the manager's `User` row (`assignedPhone`, `assignedPhoneSid`)
- Must throw on failure; the caller wraps it in `ProvisionFailedError`

### `validateWebhookSignature(req)`
- Called first on every inbound webhook before any processing
- Returns `false` if the signature is invalid — the route returns 403
- Never throws — treat any error as an invalid signature

### `parseInboundWebhook(req)`
- Called only after `validateWebhookSignature` returns `true`
- Normalizes provider-specific field names into `InboundSmsPayload`
- Must populate `to` as well as `from` — `to` is how the inbound is routed to
  the correct manager (per-manager numbers)
- Must handle both inbound SMS events and delivery status events — check the
  provider docs for how to distinguish them

---

## Webhook endpoint

Each provider gets its own route: `POST /webhooks/{provider}`. Add the new
route in three places.

**1. Register the route in `src/routes/webhooks.ts`.** Mirror the existing
Twilio route. The route receives the active `ISmsProvider` from `app.ts` and
must run validation before parsing:

```typescript
app.post('/webhooks/vonage', async (req, reply) => {
  if (!smsProvider.validateWebhookSignature(req)) {
    return reply.status(403).send()
  }
  const payload = smsProvider.parseInboundWebhook(req)
  // ...enqueue inbound job exactly like the Twilio route does
})
```

**2. Update the webhook URL in `src/services/sms/phone-number.service.ts`.**
The URL passed to `provisionNumber()` is built at line 81:
```typescript
const webhookUrl = `${phoneSettings.webhookBaseUrl}/webhooks/twilio`
```
Change the literal to match the new provider, or derive it from
`config.smsProvider` if you need to support multiple providers concurrently.

**3. Make sure `APP_BASE_URL` is reachable from the provider's servers.**
In production this is your public URL. In dev, run an ngrok tunnel pointed
at the local backend and set `APP_BASE_URL` to the ngrok URL — the provider
needs to POST inbound messages to a URL it can reach.

---

## Before going live

- [ ] Unit test all four interface methods with mocked HTTP requests
- [ ] Provision a real number end-to-end (`provisionNumber()`) and verify it's
      stored on the `User` row with both `assignedPhone` and `assignedPhoneSid`
- [ ] Send a real test SMS and verify delivery
- [ ] Verify `validateWebhookSignature` rejects a request with a tampered body
- [ ] Verify `parseInboundWebhook` returns the correct `from`, `to`, `body`,
      `messageId` (the `to` is required for routing inbound replies to the
      correct manager)
- [ ] Update `.env.example` with `SMS_PROVIDER` plus the provider's creds
- [ ] Extend `GET /integrations/status` (`src/routes/auth.ts:123`) — add a new
      block alongside `twilio`, don't replace it (both providers may be
      configured concurrently)
- [ ] If you intend to run two providers **concurrently**: rename the
      `Message.twilioSid` column (`prisma/schema.prisma:236`,
      `@map("twilio_sid")`) to a provider-neutral name like `providerMessageId`.
      For a straight swap (drop Twilio, use only the new provider) the
      column name is fine to leave as-is.
