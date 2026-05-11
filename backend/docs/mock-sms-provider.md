# Mock SMS Provider

An in-memory `ISmsProvider` implementation that records every call instead of
hitting a real SMS gateway. It exists so the rest of the app can be exercised
end-to-end — manager provisioning, broadcasts, inbound webhooks — without
paying for SMS or buying real phone numbers.

---

## Why this exists

The real provider (Twilio) charges for **every** outbound SMS, **every** phone
number purchased, and **every** inbound message routed through its servers. A
single end-to-end test of the manager-creation flow buys a real number; a
broadcast smoke test fans out paid SMS to every participant in the group.

The mock replaces the gateway, not the surrounding code:

- `provisionNumber()` returns synthetic but well-formed E.164 numbers
  (`+15550000001`, `+15550000002`, …) and synthetic SIDs (`MOCKPN0001`, …).
- `sendSms()` returns synthetic message IDs (`MOCKMSG000001`, …).
- Every call is appended to an in-memory log that test code can read back.

The rest of the app — routes, workers, business logic — runs unchanged. The
provider is selected by `SMS_PROVIDER=mock` at boot.

**Production guard:** the factory (`src/services/sms/sms.factory.ts`) refuses
to construct the mock when `NODE_ENV=production`. There is no way to ship the
mock by accident.

---

## How it slots into the architecture

```
SMS_PROVIDER=mock  ──▶  sms.factory.ts  ──▶  new MockSmsProvider()
                                                    │
                                                    ├─ provisionNumber()  → logged, returns synthetic number
                                                    ├─ sendSms()          → logged, returns synthetic message ID
                                                    ├─ validateWebhookSignature() → always true
                                                    └─ parseInboundWebhook()      → reads JSON body
```

The mock satisfies the full `ISmsProvider` interface, so it is a drop-in
replacement for `TwilioProvider`. Nothing outside `sms.factory.ts` and
`app.ts` knows which provider is active.

---

## Authentication is still required

The mock removes the **SMS cost**, not the **auth requirements**. The flows
that exercise the provider still go through the normal HTTP surface:

| To exercise | You must hit | Auth required |
|-------------|--------------|---------------|
| `provisionNumber()` | `POST /users` with `role=manager` | admin JWT |
| `sendSms()` | `POST /broadcasts` | manager JWT |
| `validateWebhookSignature()` + `parseInboundWebhook()` | `POST /webhooks/twilio` | none (signature-validated) |

Creating a manager is the cheapest way to see the mock work end-to-end, but
it still requires a Supabase auth user, a Prisma `User` row with
`role=admin`, and a signed JWT. There is **no** public unauthenticated
endpoint that triggers provisioning, by design — the mock does not change
that.

See "Bootstrap an admin" below for the one-time setup.

---

## The `_test/*` inspection API (mock-only)

The mock exposes a small inspection surface for assertions. These routes are
registered in `src/routes/_test.ts` and mounted by `app.ts` **only when the
active provider is a `MockSmsProvider`**. In any other configuration the
routes do not exist (404), so this surface cannot leak to production.

### `GET /_test/sms-log`

Returns the mock's full call log as a JSON array. Each entry is either a
`provisionNumber` or `sendSms` call. Webhook signature checks and inbound
parses are **not** logged — only the two side-effectful methods are.

```jsonc
[
  {
    "kind":             "provisionNumber",
    "country":          "US",
    "numberType":       "local",
    "webhookUrl":       "http://localhost:8082/webhooks/twilio",
    "assignedPhone":    "+15550000001",
    "assignedPhoneSid": "MOCKPN0001",
    "at":               "2026-05-11T12:00:00.000Z"
  },
  {
    "kind":      "sendSms",
    "to":        "+15557654321",
    "from":      "+15550000001",
    "body":      "Hello from the broadcast",
    "messageId": "MOCKMSG000001",
    "at":        "2026-05-11T12:00:05.000Z"
  }
]
```

### `DELETE /_test/sms-log`

Clears the call log **and** resets the internal counters (so the next
provisioned number is `+15550000001` again). Returns `204 No Content`. Use
this between scenarios when you want stable, predictable IDs.

### What the API deliberately does **not** expose

- No way to call `sendSms` or `provisionNumber` directly. Those must be
  triggered through the real business flows so the surrounding code
  (auth, validation, side effects, DB writes) is exercised too.
- No way to inject failures. If you need failure-mode testing later, add a
  dedicated endpoint — don't smuggle config through query strings.

---

## Manual testing — curl walkthrough

This walks through the full path: bootstrap an admin → create a manager →
verify the mock recorded the `provisionNumber` call.

### Setup: env shortcuts

Values below match `backend/.env.test` (local Supabase on `54321`, Postgres
on `54322`, backend on `8082`). Adjust if you're running against `.env`.

```bash
BASE=http://localhost:8082
SUPABASE_URL=http://127.0.0.1:54321
SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
ADMIN_EMAIL="admin@test.local"
```

### 1. Confirm the mock is mounted

```bash
curl -s $BASE/_test/sms-log
```
- `[]` → mock is active, log is empty. Good.
- `404` → backend was not started with `SMS_PROVIDER=mock`. Set the env
  var and restart.

### 2. Bootstrap an admin (one-time)

There is no public endpoint that grants `role=admin`, so the first admin is
planted directly. The bootstrap has three pieces — a Supabase auth user, a
Prisma row, and a matching signed JWT — because the auth middleware checks
all three.

**2a. Create the Supabase auth user:**
```bash
SUPA_ID=$(curl -s -X POST $SUPABASE_URL/auth/v1/admin/users \
  -H "apikey: $SERVICE_ROLE" \
  -H "Authorization: Bearer $SERVICE_ROLE" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"email_confirm\":true}" | jq -r .id)
echo "supabaseId = $SUPA_ID"
```

**2b. Plant the matching admin row in the app DB:**
```bash
docker exec -i supabase_db_reportloop psql -U postgres -d postgres <<SQL
INSERT INTO "User" (id, name, email, role, "supabaseId", active, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Bootstrap Admin', '$ADMIN_EMAIL', 'admin', '$SUPA_ID', true, NOW(), NOW());
SQL
```
If the container name differs, `docker ps | grep postgres` will show it.
Column names follow Prisma defaults — verify against
`backend/prisma/schema.prisma` if the schema changes.

**2c. Mint a JWT for that admin** (same shape as
`tests/src/helpers/auth.ts` → `signTestToken`):
```bash
ADMIN_JWT=$(node -e "
const c = require('crypto');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now()/1000);
const h = b64({alg:'HS256',typ:'JWT'});
const p = b64({sub:'$SUPA_ID',aud:'authenticated',role:'authenticated',email:'$ADMIN_EMAIL',iat:now,exp:now+3600});
const s = c.createHmac('sha256','$JWT_SECRET').update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
")
```

### 3. Smoke-test the admin token

```bash
curl -s $BASE/auth/me -H "Authorization: Bearer $ADMIN_JWT" | jq .
# expect: { id, email, role: "admin", ... }
```
A 401 here means one of the three bootstrap pieces is out of sync — most
often the `supabaseId` in the DB row doesn't match the Supabase auth user.

### 4. Create a manager (triggers `provisionNumber`)

```bash
curl -s -X POST $BASE/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name":     "Mock Manager",
    "email":    "mgr@test.local",
    "role":     "manager",
    "initials": "MM",
    "title":    "Test Manager"
  }' | jq .
```

### 5. Verify the mock logged the call

```bash
curl -s $BASE/_test/sms-log | jq .
```
Expected output:
```json
[
  {
    "kind":             "provisionNumber",
    "country":          "US",
    "numberType":       "local",
    "webhookUrl":       "http://localhost:8082/webhooks/twilio",
    "assignedPhone":    "+15550000001",
    "assignedPhoneSid": "MOCKPN0001",
    "at":               "2026-..."
  }
]
```

Provisioning runs in the background (`void onManagerCreated(...)` in
`src/routes/users.ts`). If the log is empty on the first read, wait a beat
and retry — the `POST /users` response returns before the provisioning task
finishes.

### 6. Reset between scenarios (optional)

```bash
curl -s -X DELETE $BASE/_test/sms-log -w "%{http_code}\n"   # expect 204
```
Clears the log **and** resets the counters, so the next provisioned number
is `+15550000001` again. Useful for keeping IDs stable across runs.

---

## Maintenance notes

- **Keep the mock surface small.** The mock is shared infrastructure — every
  field added to `MockSmsCall` is one more thing to keep in sync with
  `ISmsProvider`. Only add fields that a real test will assert on.
- **Counters are process-local.** Restart the backend and they reset to 0.
  Tests that depend on specific synthetic IDs should call
  `DELETE /_test/sms-log` in `beforeEach`.
- **Webhook signature is unconditionally `true` today.** When a test needs
  to exercise the rejection path, add header-driven control to
  `MockSmsProvider.validateWebhookSignature` — don't introduce env vars or
  global state.
- **If the `ISmsProvider` interface grows**, update the mock and this doc
  in the same commit. The mock is the canonical reference for what every
  provider must implement; drift here breaks the abstraction.
