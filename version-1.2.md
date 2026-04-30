# Version 1.2 — Performance: Faster Supabase Data Loading

## Background

Data loading from Supabase is slow due to missing database indexes, direct (non-pooled) connections, and an inefficient broadcasts query that fetches full conversation rows just to count them. This version addresses all of these in priority order.

---

## Step 1 — Add Missing Database Indexes

The schema is missing indexes on the most-used query paths, causing full table scans on every request.

| Table | Missing index | Why it hurts |
|---|---|---|
| `schedules` | `managerId` | Every broadcast list query filters on this |
| `conversations` | `broadcastId` | Every broadcast expand fetches conversations by this |
| `manager_groups` | `groupId` | Viewer/participant manager traversal joins on groupId |
| `questions` | `managerId` | Manager questions list filters on this |
| `messages` | `conversationId` | Loading messages per conversation |
| `schedule_recipients` | `userId` | Recipient lookups |

**What to do:**
- Add `@@index([managerId])` to `Schedule`
- Add `@@index([broadcastId])` to `Conversation`
- Add `@@index([groupId])` to `ManagerGroup`
- Add `@@index([managerId])` to `Question`
- Add `@@index([conversationId])` to `Message`
- Add `@@index([userId])` to `ScheduleRecipient`
- Run `prisma migrate dev --name add_performance_indexes`

- [ ] Indexes added to schema.prisma
- [ ] Migration generated and applied

---

## Step 2 — Switch to Supabase Connection Pooler

Currently `DATABASE_URL` opens a direct Postgres connection per request. Supabase provides a PgBouncer pooler (port 6543) that reuses connections, significantly reducing connection overhead especially under concurrent load.

**What to do:**
- In Supabase dashboard → Settings → Database → Connection string → select **Transaction pooler** (port 6543)
- Set `DATABASE_URL` to the pooler URL
- Keep `DATABASE_URL_DIRECT` as the direct URL (required for Prisma migrations — pooler doesn't support them)
- Update `.env.example` to document both URLs and their purpose

- [ ] `DATABASE_URL` switched to pooler URL in dev and prod environments
- [ ] `.env.example` updated with explanation

---

## Step 3 — Replace Conversation Fetch with `_count` in Broadcasts Query

The `GET /broadcasts` route currently fetches every conversation row (`select: { status: true }`) for every broadcast, then counts them in JavaScript. With many conversations this transfers unnecessary data from Supabase.

**What to do:**
- Replace the `conversations: { select: { status: true } }` select with Prisma's `_count` grouped by status
- Remove the JavaScript `.filter()` counting logic
- Stats are computed by the database, not in memory

- [ ] `GET /broadcasts` updated to use `_count` aggregate
- [ ] Stats output unchanged (same shape: `{ total, completed, failed, awaiting_reply, pending }`)

---

## Step 4 — Verify Supabase Region Matches Cloud Run Region

If Supabase and Cloud Run are in different regions, every query adds cross-region network latency. Both should be in the same region.

**What to check:**
- Supabase project region: Settings → General
- Cloud Run region: defined in `terraform/variables.tf` (`var.region`)
- If mismatched, migrate Supabase project or move Cloud Run to match

- [ ] Regions verified
- [ ] Mismatch resolved if found

---

## Priority Order

1. Step 1 — indexes (free, biggest impact)
2. Step 2 — connection pooler (significant for production under load)
3. Step 3 — query optimization (reduces data transfer)
4. Step 4 — region alignment (eliminates cross-region latency if mismatched)
