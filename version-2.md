# Version 2 — Planned Features

## Google OAuth (Sign in with Google)

The login screen currently uses email + password only (Supabase `signInWithPassword`).

Google OAuth is already partially wired in the codebase (removed from UI in v1) and requires:

1. **Google Cloud Console** — create an OAuth 2.0 Client ID (Web application), add the Supabase callback URL as an authorized redirect URI.
2. **Supabase Dashboard** → Authentication → Providers → Google — enable and paste the Client ID + Secret.
3. **Frontend** — restore `handleGoogleSignIn` using `supabaseClient.auth.signInWithOAuth({ provider: 'google' })` and add the button back to `LoginWall`.

No backend changes needed. Google provider maps the user's Google account to a Supabase auth user automatically.

---

## Improved Email Validation Error Messages

Currently when an admin creates a user with an invalid email (e.g. `test@test` — missing a real domain), the backend Supabase invite call fails silently or the Zod validation returns a generic "Request failed 400" with no clear message shown to the user.

**What to fix in v2:**

1. **Frontend** — add a basic email regex check before submitting the form so the user sees a clear inline error immediately (e.g. "Please enter a valid email address").
2. **Backend** — extract Zod field errors from the 400 response and surface them in the UI (currently `apiFetch` only reads `data.error.message`, which Zod's `flatten()` output doesn't have).
3. **Supabase invite failures** — if Supabase rejects the invite email (e.g. domain doesn't exist), log a clear warning in the backend console AND return a user-facing message explaining that the user was created but the invite email failed.

---

## Frontend as a Proper Web Application

✅ Done in v1.5 — migrated to `frontend/` (Vite + React + TypeScript).

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

## BroadcastCompose — wire Send button to real API

Currently the "Send" flow in `BroadcastCompose` is a simulated progress bar (fake). Needs to call:
- `POST /broadcasts` with `{ scheduleId, participantIds[] }` (or trigger the queue directly)
- Then navigate to Monitor to watch live responses

---

## Dashboard — wire to real data

`Dashboard` currently shows hardcoded KPI placeholders ("1 open delinquency", "2 rooms down"). Should be driven by real broadcast/conversation summary data once `GET /broadcasts` exists.

---

## Twilio Phone Number Per Manager (correctness issue + feature)

A participant can belong to multiple managers' groups. If two managers fire a broadcast at the same time, both SMS come from the same Twilio number. When the participant replies, the webhook can't tell which manager's conversation the reply belongs to — it picks one arbitrarily.

Per-manager phone numbers fixes the routing ambiguity: `From` + `To` together uniquely identify the conversation.

Full plan deferred to v2.

---

## Rate Limiting — Per-route Tuning (moved from backend_implementation.md Step 25)

v1 covers the global limit and the fire endpoint. The following are deferred:

- Per-route tighter limits on remaining sensitive endpoints (e.g. `POST /users`, `PATCH /users/:id`)
- IP allowlisting — restrict access to known office/VPN IPs if needed
- Bot detection — e.g. block requests with no `User-Agent` or suspicious patterns

---

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
