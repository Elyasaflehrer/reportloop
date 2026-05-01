# Manager Phone Number Strategy

## The Problem

All managers share one global Twilio number. When two managers broadcast to the same participant
simultaneously, inbound replies route to the wrong conversation. Each manager needs their own
dedicated number that represents them as a real person.

A secondary cost problem: if an admin repeatedly adds and removes manager roles, naively
provisioning a new number each time burns money unnecessarily.

---

## Decision: Option A — Per-Manager Number + Lazy Reuse

Each manager gets their own dedicated Twilio number. Before provisioning a new number, the system
checks for idle numbers and recycles them first. Numbers are never proactively released from
Twilio — they stay on the record and get recycled when needed.

### Provisioning trigger

Two valid approaches:

- **Eager (C1):** provision at manager creation time — number is ready immediately, ~1-2s delay at creation
- **Lazy (C2):** provision only on the manager's first broadcast — zero cost if manager never sends

### Provisioning order (3 steps, in order)

1. Does **this user** already have a `twilioNumber`? → use it directly, no Twilio call
2. Does **any other** non-manager user have an idle `twilioNumber`? → reassign it, no Twilio call
3. Provision a new number from Twilio, configure webhook, store on user

### Lifecycle

| Event | Behavior |
|---|---|
| Manager sends first broadcast | Provisioning runs (3-step order above) |
| Subsequent broadcasts | Number already assigned, used directly |
| Manager role removed | Number stays on user record — available for recycling |
| User soft-deleted | Number stays on soft-deleted record — available for recycling by Step 2 |
| Inbound SMS to a soft-deleted manager's number | `deletedAt: null` filter finds no manager → falls back gracefully, no crash |

### Why this handles all the edge cases

**Role churn:** Admin toggles manager → viewer → manager repeatedly. Step 1 ensures the same user
always reclaims their own number first — it is never reassigned to someone else.

**Soft deletion:** Admin creates a manager then deletes them. The number stays on the soft-deleted
record. When the next manager is created, Step 2 recycles it — zero Twilio cost.

**Idle number cost:** ~$1/month per number on a soft-deleted record. Acceptable for small-to-medium
teams. At scale, a periodic cleanup job can release numbers that have been idle for more than N days.

### Properties

- Each manager has a unique phone number — represents a real human identity to participants
- Role-churn safe: same user re-promoted always reclaims their own number first
- Deletion safe: soft-deleted manager's number is recycled, not wasted
- Cost proportional to managers who actually send — zero cost for inactive managers
- No extra tables, no pool sizing, no admin overhead
- Self-healing recycling — no scheduled jobs needed

---

## Future: Option B — Twilio Conversations API

If WhatsApp support is added in the future, the Twilio Conversations API is the natural migration
path. It handles SMS and WhatsApp in a single unified API — Twilio manages number assignment and
reply routing per conversation internally.

The tradeoff: most expensive option, significant API migration from raw Messages. Only worth it
when multi-channel expansion is active, not before.

---

## Comparison

| Option | Cost | Complexity | Routing | Solves race condition |
|---|---|---|---|---|
| A — Per-manager + lazy reuse | Low | Low-Medium | Your app | Yes |
| B — Twilio Conversations API *(future)* | Highest | High | Twilio | Yes |
