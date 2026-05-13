# Parallel Test Execution — Bug & Fix Plan

> **Status:** Brainstorm phase. Multiple options on the table; no implementation yet.
> **Goal:** Run the full Tier 1 (CI) suite with vitest's default `fileParallelism: true` and have every file pass.

---

## Symptom

- `npm test` (all files in parallel) → flaky / failing.
- Running each file alone (`vitest src/ci/users.test.ts`, `vitest src/ci/manager-provisioning.test.ts`, etc.) → all green.

The failure mode is **purely cross-file**. Within a single file, vitest serializes tests by default, so there's no race inside a file.

## What's enforcing serial today?

Looking at `tests/vitest.workspace.ts`, there is no `fileParallelism: false` set. Vitest's default IS parallel-by-file. So nothing is enforcing serial today — the suite is **already broken** when run as a whole, not just slow.

This sharpens the work: the refactor's job is to **make the existing parallel run pass**, not to enable parallelism.

---

## The three races

Each race is independent. Any one of them, on its own, can break a parallel run.

### Race 1 — fire-and-forget chain vs `beforeEach` cleanup

**Where:**
- Backend: `backend/src/services/manager.service.ts` (`onManagerCreated`) is called from `backend/src/routes/users.ts:222` (POST `/users` with role=manager) and `:292` (PATCH role → manager) as `void onManagerCreated(...)`. The HTTP response returns BEFORE provisioning's DB writes land.

**The race:**
1. File A test creates a manager → route returns 201 → `void onManagerCreated()` keeps running, will do `prisma.user.update({ where: { id } })` in ~50–200ms.
2. File B's `beforeEach` fires in the meantime, calls `truncateAll()`, wipes the `users` table.
3. File A's fire-and-forget update fails with P2025 ("No record found").

**Manifests as:** P2025 in the backend log, sometimes silently swallowed, sometimes propagates to a 500 on the next request that reads the row.

### Race 2 — `RESTART IDENTITY` collision

**Where:** `tests/src/helpers/db.ts:62`.

```ts
await prisma.$executeRawUnsafe(`
  TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')}
  RESTART IDENTITY CASCADE
`)
```

**The race:** Both files' `truncateAll` reset every sequence to 1 simultaneously. Both then try to INSERT user id=1 → UNIQUE PK violation on `users.id`.

**Manifests as:** "duplicate key value violates unique constraint users_pkey".

### Race 3 — `auth.users` global wipe

**Where:** `tests/src/helpers/db.ts:65`.

```ts
await prisma.$executeRawUnsafe(`DELETE FROM auth.users CASCADE`)
```

**The race:** File A's cleanup nukes Supabase auth rows that File B is mid-test on. File B's existing JWTs then hit 401 even though they were valid when the test started.

**Manifests as:** unexpected 401s in tests that previously authenticated successfully.

---

## Hazards that aren't races but will bite once we parallelize

- **Shared emails across files.** `users.test.ts` and `manager-provisioning.test.ts` both seed `admin@test.local` and `viewer@test.local`. After we scope cleanup, those will collide on `UNIQUE(email)`.
- **Process-global mock SMS log.** `clearSmsLog()` empties the entire log via `DELETE /_test/sms-log`. Only `manager-provisioning.test.ts` calls it today. If a future test file calls it, it would wipe entries mid-run for other files.

---

## Fix strategies

Split by ownership: race 1 is in the **backend**, races 2 and 3 are in the **test helper**, and the hazards are in **test files**.

### Backend code fixes (race 1)

**Option A — Tolerate row deletion in fire-and-forget chains.**

Add P2025 to `onManagerCreated`'s catch block alongside `ProvisionLimitError` and `ProvisionFailedError`. Log info, return. Semantics: "user is gone, abandon provisioning."

- ~5 lines.
- Production-meaningful: admin can legitimately create a manager and immediately delete them. Today the in-flight chain logs a noisy `unexpected error`; after this fix it logs `info` and exits cleanly.
- **Does NOT make tests deterministic** — chain still runs to completion at an unknown time, just without erroring.

**Option B — Backend exposes a drain handle.**

Track in-flight async work in `manager.service.ts` (counter or `Set<Promise>`). Expose `GET /_test/quiesce` that resolves when the counter hits zero. Tests call `await quiesce()` before `truncateAll`.

- Bigger surface, but cleanest synchronization.
- Lets us delete the `setTimeout(500)` polling patches in tests 2.5, 2.6 (planned), and 3.5.
- Test-only endpoint, registered behind the same gate as `_test/sms-log`.
- Risk: promise tracking must be airtight or the counter leaks and quiesce hangs.

**Option C — Make provisioning synchronous.**

Drop `void`; `await onManagerCreated(...)` in the route.

- Simplest test model: when the response arrives, the world is consistent.
- Reverts the eager/fire-and-forget design choice. Production response time grows by ~500ms when Twilio is slow; Twilio outages now block user creation instead of degrading to "no phone, warning logged".
- **Not recommended.** Trades production correctness for test convenience.

### Test-helper fixes (races 2, 3)

**Test-fix 1 — Drop `RESTART IDENTITY` from `truncateAll`.**

Grep confirms no current test asserts on a specific id value. Remove the keyword. Eliminates race 2 entirely.

**Test-fix 2 — Scope the `auth.users` wipe.**

Replace `DELETE FROM auth.users CASCADE` with a scoped delete:

```sql
DELETE FROM auth.users WHERE email LIKE '<scope>%'
```

What `<scope>` is depends on whether we adopt per-file prefixes (see Test-fix 3).

### Test-file fixes (email-collision hazard)

**Test-fix 3 — Resolve the shared-email hazard.** Two options:

- **(a) Per-file prefix.** `users.test.ts` uses `usr_admin@test.local`; `manager-provisioning.test.ts` uses `mp_admin@test.local`. `truncateAll(prefix)` deletes only matching rows. Lines up well with Test-fix 2.
- **(b) Per-test UUID.** `${randomUUID()}@test.local`. No collisions ever. Cleanup moves from `beforeEach` to `afterAll` (or just before the next test in the file).

(a) is the simpler change. (b) is the more bullet-proof model but a bigger refactor.

---

## Recommended sequence

1. **Backend A** (tolerate P2025) — small, production-meaningful win. Ship even if nothing else lands.
2. **Backend B** (drain handle) — unlocks deterministic tests, removes brittle timeouts.
3. **Test-fix 1** (drop `RESTART IDENTITY`).
4. **Test-fix 2** (scope `auth.users` wipe).
5. **Test-fix 3** (a or b) — only if races still appear after 1–4.
6. Verify the full suite green with `fileParallelism: true`.

Optional intermediate step: temporarily add `fileParallelism: false` to `vitest.workspace.ts` so the suite is green today while we work through 1–5. Flip it back at the end.

---

## Open decisions

1. **Backend A + B together, or A only first?** A alone is small and shippable; B is bigger but eliminates polling.
2. **`/_test/quiesce` gated on `SMS_PROVIDER=mock`, or its own `TEST_HARNESS=1` env?** Don't want a quiesce probe in prod.
3. **Scope of in-flight tracking** — just `onManagerCreated`, or every fire-and-forget in the backend? Today there's only one fire-and-forget chain in the paths the current tests touch.
4. **Test-fix 3 choice** — prefix-per-file (a) or UUID-per-test (b)? Defer until we see if 1–4 alone is enough.
5. **Stop-gap `fileParallelism: false`** during the migration, yes/no? Keeps "all tests" green today but masks the bug while we work.

---

## Out of scope

- Per-worker DB schemas (`SET search_path`). Ruled out as too heavy for current suite size.
- Per-worker backend processes (one backend per vitest worker). Same reasoning.
- Redis namespacing per file. No current tests touch queues; flag for later.

---

## Next steps

Once the open decisions above are resolved, write a per-step implementation plan (one section per numbered step in "Recommended sequence") with concrete file paths, signatures, and assertions. Then execute step by step, getting review after each.
