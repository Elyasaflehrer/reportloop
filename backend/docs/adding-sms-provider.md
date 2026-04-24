# Adding a New SMS Provider

The SMS layer uses an interface + adapter + factory pattern. Adding a new provider
(Vonage, Plivo, AWS SNS, etc.) requires changes in exactly 4 places and zero
changes to any route, worker, or business logic.

---

## Architecture overview

```
broadcast.service.ts  ─┐
conversation.worker.ts ─┼──▶  ISmsProvider  ──▶  TwilioProvider   (today)
webhooks.ts           ─┘                    ──▶  VonageProvider   (future)
```

The rest of the app calls `sendSms()`, `validateWebhookSignature()`, and
`parseInboundWebhook()` on the active provider instance. It never imports
a provider directly.

---

## Step-by-step checklist

### 1. Add env vars to `.env.example`

Follow the naming convention `{PROVIDER}_{VAR}`:

```bash
# Vonage (if SMS_PROVIDER=vonage)
VONAGE_API_KEY=
VONAGE_API_SECRET=
VONAGE_FROM_NUMBER=
```

### 2. Add the provider config block to `src/config.ts`

Add an optional block alongside the existing `twilio` block:

```typescript
vonage: z.object({
  apiKey:     z.string(),
  apiSecret:  z.string(),
  fromNumber: z.string(),
}).nullable().default(null),
```

Map it from `process.env`:
```typescript
vonage: process.env.VONAGE_API_KEY ? {
  apiKey:     process.env.VONAGE_API_KEY,
  apiSecret:  process.env.VONAGE_API_SECRET ?? '',
  fromNumber: process.env.VONAGE_FROM_NUMBER ?? '',
} : null,
```

### 3. Create `src/services/sms/providers/{name}.provider.ts`

Implement all three methods of `ISmsProvider`:

```typescript
import type { FastifyRequest } from 'fastify'
import type { ISmsProvider, InboundSmsPayload } from '../sms.provider.interface.js'

export class VonageProvider implements ISmsProvider {

  async sendSms(to: string, body: string): Promise<string> {
    // Send via Vonage SDK. Return the provider's message ID.
    // Throw a domain error (not the raw SDK error) on failure.
  }

  validateWebhookSignature(req: FastifyRequest): boolean {
    // Verify the request genuinely came from Vonage.
    // Return false if signature is invalid — never throw here.
  }

  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload {
    // Map Vonage's webhook body to the common InboundSmsPayload shape.
    // Vonage posts: { msisdn, text, messageId }
    const body = req.body as Record<string, string>
    return {
      from:      body.msisdn,
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

Every provider must implement exactly these three methods:

```typescript
interface ISmsProvider {
  sendSms(to: string, body: string): Promise<string>
  validateWebhookSignature(req: FastifyRequest): boolean
  parseInboundWebhook(req: FastifyRequest): InboundSmsPayload
}

type InboundSmsPayload = {
  from:      string  // E.164 phone number e.g. +15551234567
  body:      string  // raw message text from the employee
  messageId: string  // provider's unique message ID (used as idempotency key)
}
```

### `sendSms(to, body)`
- `to`: E.164 phone number
- `body`: pre-built SMS text from `sms.service.ts`
- Returns: provider's message ID (stored as `Message.twilioSid` for idempotency)
- Must set a status/delivery callback URL so failed deliveries are reported back
- Must throw a domain-level error (`SmsDeliveryError`) — never let the raw SDK error bubble up

### `validateWebhookSignature(req)`
- Called first on every inbound webhook before any processing
- Returns `false` if the signature is invalid — the route returns 403
- Never throws — treat any error as an invalid signature

### `parseInboundWebhook(req)`
- Called only after `validateWebhookSignature` returns `true`
- Normalizes provider-specific field names into `InboundSmsPayload`
- Must handle both inbound SMS events and delivery status events — check the
  provider docs for how to distinguish them

---

## Webhook endpoint

The existing `POST /webhooks/twilio` route may need a provider-aware path or a
shared path depending on the new provider. Options:
- **Shared path** (`POST /webhooks/sms`): works if the provider lets you configure
  the callback URL to any path
- **Provider-specific path** (`POST /webhooks/vonage`): required if the provider
  sends to a fixed path

Update `src/routes/webhooks.ts` and the `APP_BASE_URL` + provider SDK config
accordingly.

---

## Before going live

- [ ] Unit test all three interface methods with mocked HTTP requests
- [ ] Send a real test SMS and verify delivery
- [ ] Verify `validateWebhookSignature` rejects a request with a tampered body
- [ ] Verify `parseInboundWebhook` returns the correct `from`, `body`, `messageId`
- [ ] Update `.env.example` with the new provider's vars
- [ ] Update `GET /integrations/status` to reflect the new provider
