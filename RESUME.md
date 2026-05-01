# Resume — Last Session

## What we did

Full brainstorming and strategy finalization for **Version 1.2 — Per-Manager Twilio Phone Numbers**.

---

## Strategy Decision

Chose **Option A — Per-Manager Number + Lazy Reuse**.

Each manager gets their own dedicated Twilio number, provisioned at creation time.
Numbers are never proactively released — they stay on the user record and get recycled.
No global fallback number (`TWILIO_FROM_NUMBER` removed entirely).

Full strategy documented in: `backend/docs/per-manager-phone-numbers.md`

---

## Key Decisions Made

### Provisioning
- **C1 (eager):** number provisioned at manager creation time
- **3-step order:** own number → idle number from another user → new Twilio purchase
- **Role-churn safe:** same user re-promoted always reclaims their own number first
- **Soft-delete safe:** number stays on soft-deleted record, recycled by Step 2

### Cost Controls
- `TWILIO_MAX_NUMBERS` env var (default 50) — caps total Twilio purchases
- `TWILIO_NUMBER_COUNTRY` env var (default `US`)
- `TWILIO_NUMBER_TYPE` env var (default `local`)
- Webhook URL built from existing `API_BASE_URL`: `{API_BASE_URL}/webhooks/sms`

### Broadcast Guard
- Manager without `twilioNumber` is **blocked** — no exceptions, no fallback
- Frontend: "Send now" and "Schedule" buttons disabled with message: *"No phone number assigned to your account. Contact your admin."*
- Backend: broadcast service rejects the request

### Inbound Routing
- Routes by `To` (manager's number) + `From` (participant's phone)
- `500` for transient server errors — Twilio retries
- `200` + log for permanent failures (no manager found, participant not found)
- `WEBHOOK_RETRY_ATTEMPTS` env var (default 2) — internal retries before returning 500

### No Global Number
- `TWILIO_FROM_NUMBER` removed from config entirely
- Every SMS must come from the manager's own `twilioNumber`

### Existing Managers
- Not migrated — blocked from broadcasting until a number is manually assigned via DB
- Acceptable for initial rollout

### DB Fields Added
- `twilioNumber` — E.164 phone number string, unique
- `twilioNumberSid` — Twilio resource SID, stored for future cleanup/release

---

## Files Created / Updated

| File | What changed |
|---|---|
| `backend/docs/per-manager-phone-numbers.md` | New — full strategy doc |
| `manager-phone-strategy.md` | Brainstorming file — options narrowed to A (chosen) + G (future WhatsApp) |
| `version-1.2.md` | Implementation plan — needs rewrite to match final decisions |

---

## Next Steps

1. Rewrite `version-1.2.md` to match all final decisions above
2. Implement step by step
