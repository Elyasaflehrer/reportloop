# Where We Left Off

## Current Status

**Phase 0 — Frontend Cleanup: ✅ Complete**  
**Phase 1 — Foundation: ✅ Complete**  
**Phase 2 — CRUD APIs: ✅ Complete**  
**Phase 3 — Broadcast Engine: ✅ Complete**  
**Phase 4 — Webhooks & Conversations: ✅ Complete**  
**Phase 5 — Frontend Cutover: ✅ Complete (1 uncommitted change pending)**  
**Phase 6 — Production Hardening: 🔲 Not started**

---

## Uncommitted Changes (commit before switching tasks)

`AI_Reporter.html` has staged changes that were NOT committed yet. Run:

```bash
git add AI_Reporter.html
git commit -m "Wire ManagerQuestionsPanel and ManagerSchedulePanel to real API; fix participant visibility"
```

What these changes include:
- **ManagerQuestionsPanel** — replaced localStorage stubs with POST/PATCH/DELETE `/questions`
- **ManagerSchedulePanel** — replaced localStorage stubs with full schedule CRUD API calls; added timezone selector
- **ManagerParticipantsPanel** — NEW component; added "Participants" tab to manager workspace showing group-scoped participants
- **BroadcastCompose** — "Questions the AI will ask" preview now uses real questions from AppData
- **AdminUsersTab** — added "participant" role option to Add User form (phone required, no invite email)
- **AdminGroupsTab** — removed participants-exclusion filter from group member picker so admins can add participants to groups directly

---

## How to Start the Server

```bash
# Start Redis
docker start reportloop-redis
# (if removed: docker run -d --name reportloop-redis -p 6379:6379 redis:7-alpine)

# Start backend
cd /home/elyasaf/workstation/reportloop/backend
npm run dev

# Serve frontend (in another terminal)
cd /home/elyasaf/workstation/reportloop
npx serve . -p 8080
```

---

## Key Auth Facts

- JWT is **ES256** (asymmetric). `jwt.verify(token, secret)` does NOT work — always use `supabaseAdmin.auth.getUser(token)`.
- On first login, `supabase_id` is auto-linked to the DB user row by email lookup.
- `GET /auth/me` is called by the frontend on every login to get the real DB role (overrides stale JWT metadata).
- Admin role changes call `supabaseAdmin.auth.admin.updateUserById` to sync JWT metadata immediately.

---

## Admin Setup Flow (for testing)

1. Admin → **Users & Roles** tab → Add participant (role: participant, phone required)
2. Admin → **Users & Roles** tab → Find participant row → click "Groups…" → assign to a group
   — OR —
   Admin → **Groups** tab → Edit group → member picker now includes participants → add participant
3. Admin → **Manager Groups** tab → select manager → click "Assign groups…" → pick the group
4. Manager logs in → **Participants** tab → sees the participant
5. Manager → **Schedule** tab → Add schedule → Subset mode → participant appears in recipient picker

---

## Current Git State

Branch: `dev/claude`  
Last commit: `0f4080b` — Fix session role: call GET /auth/me on login to get role from DB

Recent commits (Phase 5 work):
- `0f4080b` — Fix session role: call GET /auth/me on login to get role from DB
- `dfcbc76` — Fix invite flow: link supabase_id at creation and sync role changes to Supabase
- `a7172e3` — Fix auth: auto-link supabase_id on first login and remove stale debug log
- `dc7f198` — Add local development guide and version-2 backlog
- `5f6c95d` — Phase 5: wire AdminUsersTab, AdminGroupsTab, AdminManagerGroupsTab to real API
- `fc6566d` — Raise pagination limit cap from 100 to 500 on all list endpoints
- `4822a77` — Fix JWT auth: replace jwt.verify with supabaseAdmin.auth.getUser

---

## Phase 6 — Production Hardening (Next)

- [ ] Rate limiting on auth and SMS endpoints
- [ ] Error monitoring (Sentry or similar)
- [ ] Database connection pooling tuning
- [ ] Environment variable validation on startup
- [ ] CORS configuration for production domain
- [ ] Supabase RLS policies review
- [ ] Load testing / SMS throughput validation
- [ ] Logging structured output (already using pino)

---

## Overall Progress

| Phase | Status |
|---|---|
| Phase 0 — Frontend Cleanup | ✅ Complete |
| Phase 1 — Foundation | ✅ Complete |
| Phase 2 — CRUD APIs | ✅ Complete |
| Phase 3 — Broadcast Engine | ✅ Complete |
| Phase 4 — Webhooks & Conversations | ✅ Complete |
| Phase 5 — Frontend Cutover | ✅ Complete (1 uncommitted change) |
| Phase 6 — Production Hardening | 🔲 Not started |
