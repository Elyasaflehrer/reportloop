# Version 2 — Planned Features

## Supabase RLS Policies (moved from backend_implementation.md Step 24)

Write Row Level Security policies on all tenant-scoped tables in Supabase.

**Why both RLS + route-layer RBAC:**
Route layer is the first line of defense (fast, flexible). RLS is defense in depth — even if a bug in our code queries the wrong data, Postgres itself rejects the read. Two independent layers means a bug in one doesn't become a data breach.

**Example RLS policy for `Conversation`:**
```sql
CREATE POLICY "managers_see_own_conversations" ON conversations
  FOR SELECT USING (
    broadcast_id IN (
      SELECT b.id FROM broadcasts b
      JOIN schedules s ON s.id = b.schedule_id
      WHERE s.manager_id = auth.uid()
    )
  );
```

Tables that need policies: `users`, `groups`, `group_members`, `manager_groups`, `questions`, `schedules`, `schedule_questions`, `schedule_recipients`, `broadcasts`, `conversations`, `messages`, `answers`.

---

## Rate Limiting — Per-route Tuning (moved from backend_implementation.md Step 25)

v1 covers the global limit and the fire endpoint. The following are deferred:

- Per-route tighter limits on remaining sensitive endpoints (e.g. `POST /users`, `PATCH /users/:id`)
- IP allowlisting — restrict access to known office/VPN IPs if needed
- Bot detection — e.g. block requests with no `User-Agent` or suspicious patterns

---

## Twilio Phone Number Per Manager (correctness issue + feature)

A participant can belong to multiple managers' groups. If two managers fire a broadcast at the same time, both SMS come from the same Twilio number. When the participant replies, the webhook can't tell which manager's conversation the reply belongs to — it picks one arbitrarily.

Per-manager phone numbers fixes the routing ambiguity: `From` + `To` together uniquely identify the conversation.

Full plan deferred to v2.

---

## Stale Session — Manager List Out of Sync

If an admin reassigns a viewer's groups while the viewer is logged in, their manager list in the dropdown becomes stale until they re-login. Need to make a plan for detecting and handling this — options include periodic refresh of `/auth/me`, a manual "refresh" button, or a session TTL that forces re-login. No implementation yet, plan needed first.

When a stale manager is selected and the backend rejects access (403), the viewer currently sees "Failed to load data. Please contact support." — acceptable for v1 since there is no data leak. Two longer-term options to consider:
- **Option A:** Keep the stale manager visible but scope the data to only the viewer's own conversations (requires backend scoping logic).
- **Option B:** Remove stale managers from the list on next /auth/me refresh, and add a "My Conversations" tab showing the viewer's own conversation history across all managers they ever belonged to.

---

## Improved Email Validation Error Messages

Currently when an admin creates a user with an invalid email (e.g. `test@test` — missing a real domain), the backend Supabase invite call fails silently or the Zod validation returns a generic "Request failed 400" with no clear message shown to the user.

**What to fix in v2:**

1. **Frontend** — add a basic email regex check before submitting the form so the user sees a clear inline error immediately (e.g. "Please enter a valid email address").
2. **Backend** — extract Zod field errors from the 400 response and surface them in the UI (currently `apiFetch` only reads `data.error.message`, which Zod's `flatten()` output doesn't have).
3. **Supabase invite failures** — if Supabase rejects the invite email (e.g. domain doesn't exist), log a clear warning in the backend console AND return a user-facing message explaining that the user was created but the invite email failed.

---

## Manager Switcher — Loading State on Switch

When the viewer switches managers, the conversation list re-fetches but currently shows no loading indicator. Add a visible loading state (spinner or skeleton rows) so the viewer knows the data is updating and doesn't think the screen is broken.

---

## Google OAuth (Sign in with Google)

The login screen currently uses email + password only (Supabase `signInWithPassword`).

Google OAuth is already partially wired in the codebase (removed from UI in v1) and requires:

1. **Google Cloud Console** — create an OAuth 2.0 Client ID (Web application), add the Supabase callback URL as an authorized redirect URI.
2. **Supabase Dashboard** → Authentication → Providers → Google — enable and paste the Client ID + Secret.
3. **Frontend** — restore `handleGoogleSignIn` using `supabaseClient.auth.signInWithOAuth({ provider: 'google' })` and add the button back to `LoginWall`.

No backend changes needed. Google provider maps the user's Google account to a Supabase auth user automatically.

---

## Correspondences Tab — UI/UX Redesign

The current Correspondences tab (manager + participant) is not well organized. The information hierarchy needs to be rethought so users can easily navigate their broadcast history and conversations. Design work required before implementation.

**Key data point:** schedules have a label/description — conversations should be grouped by that description (e.g. all "Weekly send" conversations together, all "Monthly review" conversations together).

**Filtering:** users should be able to filter the view by question, by participant, by date/date range, and potentially by conversation status.

---

## Missing Backend API Endpoints (needed to unblock frontend screens)

The following screens exist in the frontend but **show no data** because the backend routes haven't been built yet:

### `GET /broadcasts`
- Needed by: `History`, `Dashboard`, `BroadcastCompose` (recipients list), `Monitor`
- Returns: list of broadcast jobs (label, date, status, scheduleId)
- RBAC: admin sees all; manager sees only broadcasts linked to their groups; viewer scoped same as manager

### `GET /broadcasts/:id/conversations`
- Needed by: `History` (expand a broadcast → see per-participant thread rows)
- Returns: list of conversations for a broadcast (participantId, status, startedAt)

### `GET /conversations/:id/messages`
- Needed by: `LogModal` (Full Transcript view)
- Returns: ordered message list (role: `ai` | `participant`, text, createdAt)

### `GET /conversations/:id/analysis`
- Needed by: `LogModal` (AI Analysis view)
- Returns: extracted Q&A pairs with optional flag (`red` | `amber` | null)

---

## Screens blocked until above endpoints are built

| Screen | Blocked on |
|---|---|
| `History` | `GET /broadcasts`, `GET /broadcasts/:id/conversations` |
| `LogModal` | `GET /conversations/:id/messages`, `GET /conversations/:id/analysis` |
| `Monitor` | `GET /broadcasts/:id/conversations` (live view) |
| `Dashboard` | `GET /broadcasts` (today's broadcast summary) |
| `BroadcastCompose` | recipients from `GET /participants` ✅ already works; sends via existing queue |
| `AdminCorrespondencesHierarchy` | same as History |
| `ParticipantPortal` | `GET /broadcasts`, `GET /conversations/:id/messages` |

---

## Frontend as a Proper Web Application

✅ Done in v1.5 — migrated to `frontend/` (Vite + React + TypeScript).

---

## BroadcastCompose — wire Send button to real API

Currently the "Send" flow in `BroadcastCompose` is a simulated progress bar (fake). Needs to call:
- `POST /broadcasts` with `{ scheduleId, participantIds[] }` (or trigger the queue directly)
- Then navigate to Monitor to watch live responses

---

## Deferred from Step 16 — Webhook Routing

### Per-number opt-out

Currently STOP opts the participant out of the entire platform globally — any STOP from any
manager number applies platform-wide. This was an intentional v1 simplification.

**What per-number opt-out would require:**
- A `UserOptOut` join table: `(userId, managerPhone)` — one row per participant/number pair
- `handleOptOut(from, to)` reads this table instead of the global `smsOptedOut` flag
- `handleOptIn(from, to)` removes only the matching row
- Compliance note: Twilio still applies global carrier-level blocks on STOP — per-number
  opt-out is a product-layer preference on top of Twilio's behavior, not a replacement

---

### Participant-initiated conversations

Currently, if a participant texts a manager's number with no open conversation, the webhook
logs a warning and returns 200. No new conversation is created.

**Future behavior:** participant texts a manager's number → if no open conversation, create
a new one on-the-fly and route the message into it. Requires:
- A product decision: which schedule template does the new conversation attach to?
- A new `conversation.create` code path in `handleRegularMessage` (Case 5)
- A UI change so managers can see and respond to participant-initiated threads

---

### Redis-down stuck conversation cleanup job

**The scenario:** lock + `message.create` committed in DB (in `$transaction`), but the
subsequent `conversationQueue.add` fails because Redis is unavailable → the BullMQ job
is never queued → conversation stays stuck in `processing` forever.

The `$transaction` fix (Case 13) does not help here — the DB transaction already committed
before the queue write attempt.

**What's needed in v2:**
- A periodic cleanup job (cron or BullMQ repeatable) that finds conversations stuck in
  `processing` with a `lastMessageAt` older than N minutes and re-enqueues them
- Or: a DB flag `enqueueConfirmedAt` on `Message` — set it after `conversationQueue.add`
  succeeds; the cleanup job looks for messages where it's null

---

`Dashboard` currently shows hardcoded KPI placeholders ("1 open delinquency", "2 rooms down"). Should be driven by real broadcast/conversation summary data once `GET /broadcasts` exists.
