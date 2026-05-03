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

**Chosen: Eager (C1)** — provision at manager creation time via `onManagerCreated`.
Number is ready immediately. If provisioning fails, manager is still created without a number
and can self-provision later via the "Request phone number" button.

### Provisioning order (3 steps, in order)

1. Does **this user** already have a `assignedPhone`? → use it directly, no Twilio call
2. Does **any other** non-manager user have an idle `assignedPhone`? → reassign it, no Twilio call
3. Provision a new number from Twilio, configure webhook, store on user

### Lifecycle

| Event | Behavior |
|---|---|
| Manager sends first broadcast | Provisioning runs (3-step order above) |
| Subsequent broadcasts | Number already assigned, used directly |
| Manager role removed | `assignedPhone` stays on user record — available for recycling. Manager's schedules + questions are **soft-deleted**. `ManagerGroup` links are **deleted** — groups themselves survive for reassignment |
| Manager re-promoted | Clean slate: no schedules, no questions, no group assignments. Phone provisioning Step 1 reclaims their own number immediately — no Twilio call |
| User soft-deleted | Number stays on soft-deleted record — available for recycling by Step 2 |
| Inbound SMS to a soft-deleted manager's number | `deletedAt: null` filter finds no manager → falls back gracefully, no crash |

### Why this handles all the edge cases

**Role churn:** Admin toggles manager → viewer → manager repeatedly. Step 1 ensures the same user
always reclaims their own number first — it is never reassigned to someone else.

**Manager demotion:** Schedules and questions are role-context data — they belong to a manager's
tenure with a specific team. When the role ends, that context is stale. Soft-deleting them gives
a clean slate on re-promotion (new team, new questions, new schedule) while preserving the audit
trail (past broadcasts and their responses remain intact). The scheduler's `deletedAt: null` filter
already excludes soft-deleted schedules — no ghost broadcasts, no BullMQ noise.

Group assignments (`ManagerGroup`) are also removed on demotion. Groups themselves are
organizational units — the participants inside them are untouched. The admin reassigns orphaned
groups to a new manager rather than recreating them from scratch.

**Consistency guarantee:** The role change and schedule soft-delete are wrapped in a single
`$transaction` — they commit together or not at all. An active schedule on a non-manager
would trigger live broadcasts (the `assignedPhone` stays set), so this pair must be atomic.
Question soft-delete and group unlink are best-effort after commit — stale data but no
operational risk.

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

## Future: Option B — WhatsApp

WhatsApp penetration in Israel is ~85%+. When adding WhatsApp support, the `ISmsProvider`
interface is already designed to swap providers — a new `WhatsAppProvider` implements the
same interface.

Key considerations for WhatsApp:
- Numbers must be registered with Meta's WhatsApp Business API (not fully automatable — OTP verification required per number)
- Recommended approach: pre-provision a pool of WhatsApp numbers; assign from pool on manager creation
- Pricing: per conversation window (~$0.015), not per message — significantly cheaper than Israeli SMS rates (16.5 EUR/100 SMS vs 0.70 EUR/100 SMS for US numbers)
- The `ISmsProvider` interface and `provisionForManager` 3-step logic work unchanged — only the provider implementation changes

Note: `assignedPhone` field name is channel-agnostic by design — works for both SMS and WhatsApp numbers.

---

## Comparison

| Option | Cost | Complexity | Routing | Solves race condition |
|---|---|---|---|---|
| A — Per-manager + lazy reuse (SMS) | Low–High* | Low-Medium | Your app | Yes |
| B — WhatsApp Business API *(future)* | Low (per conversation) | Medium | Your app | Yes |

*SMS cost varies significantly by country: US ~0.70 EUR/100 SMS, Israel ~16.5 EUR/100 SMS.
