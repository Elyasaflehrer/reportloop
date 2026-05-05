# `@reportloop/tests` — Backend Test Package

This is the backend test suite. It runs HTTP requests against a separately-
running backend instance and asserts on the responses + database state.

The full scenario plan (184 scenarios across 16 feature categories) lives in
`./backend-test-plan.md`. This README explains **how the test package itself
is organised**, **why it's organised that way**, and **how to use it**.

---

## Purpose

To prove the backend works end-to-end — without any dependency on the
frontend, without any internal-import shortcuts, and at two different levels
of realism (CI for every commit, E2E pre-production).

The goal is a test suite that is:

- **Realistic** — tests exercise the real backend over real HTTP, against a
  real DB and real Redis. Nothing gets bypassed.
- **Black-box** — tests cannot reach into backend internals. Whatever the
  test does, a real API client could do too.
- **Frontend-independent** — the frontend never needs to be installed or
  running. Tests work purely against the backend's HTTP API.
- **Two-tier** — most tests run on every commit (mocked Twilio, fast); a
  small canonical set runs before each release (real Twilio, real money).

---

## Architecture

### The two-process model

The test package does not embed the backend. The backend runs as its own
process; tests fire HTTP requests at it.

```
Terminal 1                              Terminal 2
─────────────                           ──────────────
cd backend                              cd tests
npm run dev                             npm test
                                          │
backend running on :8082 ◄────HTTP────────┘
   ├─ Postgres (test DB)
   ├─ Redis (test queues)
   └─ Twilio (mocked or real)
```

This split has three concrete benefits:

1. **Tests run against the real backend stack** — every middleware, validator,
   and RBAC check is exercised on every request. There is no "in-process
   fast path" that production users wouldn't hit.
2. **Same tests work in any environment** — local dev, ngrok-exposed staging,
   or a deployed test environment. Just point `BACKEND_URL` somewhere
   different.
3. **The API is the only surface** — if a behaviour can't be triggered or
   asserted via HTTP, it isn't tested. This forces the API design to be
   complete.

### What "real" means here

| Layer | Tier 1 (CI) | Tier 2 (E2E) |
|---|---|---|
| Postgres | Real (test DB) | Real |
| Redis | Real (test queues) | Real |
| BullMQ workers | Real, started by backend | Real |
| Twilio outbound | **Mocked** at `ISmsProvider` boundary | **Real** SMS sent |
| Twilio inbound | Locally signed Twilio-format webhooks | Real Twilio webhook delivery |
| Supabase auth | JWTs signed locally with the real `SUPABASE_JWT_SECRET` | Same |

The **only** thing CI mocks is Twilio. Everything else is real. This is
deliberate — Twilio is the only external dependency that costs money and
that we don't own.

### Why a separate package (not `backend/test/`)

We considered putting tests inside `backend/`. We chose a separate package
for these reasons:

- **Black-box discipline** — a test in `backend/test/` can `import { foo }
  from '../src/foo.ts'` and bypass the API. A test in `tests/` physically
  cannot. This guarantees tests behave like real clients.
- **Independent dependency tree** — the test package can adopt heavy
  dependencies (HTTP client libraries, ngrok bindings, real Twilio SDK
  for outbound test SMS) without bloating backend's bundle.
- **Same package can target multiple environments** — local dev, staging,
  pre-production. Just change `BACKEND_URL`.

The trade-off: tests cannot write service-level unit tests (calling
`provisionForManager` directly). For the rare cases where pure-function unit
tests are wanted, write them inside `backend/` co-located with the source.

### Why two tiers

A single tier doesn't work. If every test runs against real Twilio, the
suite is too slow and expensive to run on every commit. If no test runs
against real Twilio, you're guessing about Twilio's actual behaviour.

The split gets both:

- **Tier 1 (CI)** runs on every commit. ~5 minutes, $0. Catches code-level
  regressions in 95% of scenarios.
- **Tier 2 (E2E)** runs before each release. ~30–45 minutes, ~$0.50. Proves
  the Twilio integration actually works end-to-end against the real
  Twilio platform.

---

## Project structure

```
tests/
├── package.json
├── tsconfig.json
├── vitest.workspace.ts         ← defines the `ci` and `e2e` projects
├── .env.example                ← copy to .env (gitignored) and fill in
├── .gitignore
├── README.md                   ← you are here
└── src/
    ├── helpers/
    │   ├── api.ts              ← HTTP client wrapper (get, post, patch, del)
    │   ├── auth.ts             ← signTestToken({ supabaseId }) — mints Supabase-shaped JWTs
    │   └── db.ts               ← Prisma client + truncateAll() for cleanup
    ├── ci/                     ← Tier 1 — every-commit tests
    │   ├── smoke.test.ts       ← reachability + auth gate tests
    │   └── ...                 ← (add more, organised by feature)
    └── e2e/                    ← Tier 2 — pre-production tests
        └── ...
```

### Helper responsibilities

**`api.ts`** — `get(path, token?)`, `post(path, token, body?)`,
`patch(path, token, body)`, `del(path, token)`. Wraps `fetch`. Reads
`BACKEND_URL` from env (defaults to `http://localhost:8082`). Adds
`Authorization: Bearer <token>` if a token is given. Parses JSON responses
gracefully.

**`auth.ts`** — `signTestToken({ supabaseId, email?, expiresInSeconds? })`.
Signs an HS256 JWT using `SUPABASE_JWT_SECRET` from env. The backend's auth
middleware verifies these the same way it verifies real Supabase tokens.

**`db.ts`** — `prisma` (a `PrismaClient` instance pointed at the test DB)
and `truncateAll()` (wipes all non-system tables). Used **only** for
test setup / teardown / DB-state assertions, **never** to bypass the API.

A safety check refuses to truncate unless `TEST_DATABASE_URL` contains
`test`, `local`, or `tmp` — guards against accidentally nuking real data.

---

## Setup

You need to set this up once. Total time: ~10 minutes of clicking and
copying.

### 1. Install dependencies

```bash
cd tests
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | What goes here |
|---|---|
| `BACKEND_URL` | URL of the running backend (`http://localhost:8082` for local dev) |
| `SUPABASE_JWT_SECRET` | Same value as `backend/.env`. Tests sign their own JWTs locally |
| `TEST_DATABASE_URL` | Postgres connection string for the test DB. Must NOT be your dev/prod DB |

### 3. (Tier 1 only) Make sure you have a test database

The test DB must be **separate from your dev DB**. Tests truncate all tables
between runs. Pointing them at your dev DB will destroy your data.

For the easiest local setup:

```bash
# Create a test database in your local Postgres
createdb reportloop_test

# Apply your schema to it
cd ../backend
DATABASE_URL=postgresql://localhost/reportloop_test npx prisma db push

# Now point tests at it
echo 'TEST_DATABASE_URL=postgresql://localhost/reportloop_test' >> ../tests/.env
```

(Adjust user/password/host as needed for your Postgres setup.)

### 4. Start the backend pointing at the test DB

In a separate terminal:

```bash
cd backend
DATABASE_URL=$TEST_DATABASE_URL npm run dev
```

Or set up `backend/.env.test` and load it explicitly. The backend must connect
to the same DB that the tests will inspect.

### 5. Run the smoke test

```bash
cd tests
npm test
```

The smoke test (`src/ci/smoke.test.ts`) hits a few unauthenticated endpoints
and asserts on the response codes. If those pass, the harness is wired up
correctly.

---

## Running tests

```bash
npm test               # Tier 1 (CI) only — ~5 minutes, mocked Twilio
npm run test:watch     # Tier 1 in watch mode — for iterating on tests
npm run test:e2e       # Tier 2 (E2E) only — ~30–45 minutes, real Twilio
npm run test:all       # Both tiers — typically only run pre-release
```

Filter to a single test file:

```bash
npm test -- src/ci/smoke.test.ts
```

Filter to tests matching a name:

```bash
npm test -- -t "creates a manager"
```

---

## Writing a new test

### Pattern

Every test file follows the same shape:

```ts
import { beforeEach, describe, it, expect } from 'vitest'
import { get, post, del } from '../helpers/api.ts'
import { signTestToken } from '../helpers/auth.ts'
import { prisma, truncateAll } from '../helpers/db.ts'

describe('User CRUD', () => {
  let adminToken: string

  beforeEach(async () => {
    // 1. Wipe the DB so each test starts from a known state
    await truncateAll()

    // 2. Seed the bare minimum we need (an admin to authenticate as)
    const admin = await prisma.user.create({
      data: {
        name:       'Test Admin',
        email:      'admin@test.local',
        role:       'admin',
        supabaseId: 'test-admin-id',
      },
    })
    adminToken = signTestToken({ supabaseId: admin.supabaseId! })
  })

  it('admin creates a viewer user', async () => {
    // 3. Exercise via HTTP
    const res = await post('/users', adminToken, {
      name:  'Alice',
      email: 'alice@test.local',
      role:  'viewer',
    })

    // 4. Assert on the response
    expect(res.status).toBe(201)

    // 5. (optional) Assert on DB state directly for things the API doesn't surface
    const inDb = await prisma.user.findFirst({ where: { email: 'alice@test.local' } })
    expect(inDb?.role).toBe('viewer')
  })
})
```

### Rules of the road

- **Behaviour goes through HTTP.** Never call backend services directly.
- **Setup can use `prisma`.** Seeding via API is too slow for some scenarios
  (e.g., creating a soft-deleted user with `deletedAt` set). Direct DB writes
  for setup are fine.
- **`truncateAll()` in `beforeEach`** for any test that touches DB state.
  Don't rely on test order.
- **One concept per test.** A test that creates, updates, and deletes a user
  in one `it()` is harder to debug than three separate tests.

---

## How tests are tagged into tiers

A test goes in **Tier 1 (CI)** by default — file lives under `src/ci/`.
Vitest's `--project ci` only picks up tests under that directory.

A test goes in **Tier 2 (E2E)** if it requires real Twilio behaviour the CI
mocks can't faithfully reproduce — file lives under `src/e2e/`. The `e2e`
project has a longer per-test timeout (120s) because real Twilio and AI
processing take seconds.

When deciding which tier a new test belongs in, ask:

- Does the test need a real SMS to actually be delivered? → **E2E**
- Does the test need Twilio's real signature on a webhook? → **E2E**
- Does the test verify anything about real outbound SMS pricing, carrier
  behaviour, or delivery latency? → **E2E**
- Anything else → **CI**

Most scenarios are CI. Only ~15 of the 184 in the plan need to be E2E.

---

## Common pitfalls

**"My test passes but the backend is down"** — `fetch` failures throw, but
some tests might catch them silently. The smoke test (`src/ci/smoke.test.ts`)
runs first and will fail fast if the backend is unreachable.

**"My test fails because of stale DB state"** — make sure your `beforeEach`
calls `truncateAll()`. If you have parallel tests, vitest runs them in
separate workers — each worker truncates the same shared DB, so parallel
runs interfere. For now, run sequentially: `vitest --no-isolate
--no-file-parallelism`.

**"`truncateAll()` refused to run"** — your `TEST_DATABASE_URL` doesn't
contain `test`, `local`, or `tmp`. The safety guard refuses; rename your
test DB or override at your own risk.

**"`SUPABASE_JWT_SECRET` is undefined"** — `tests/.env` is missing or doesn't
have the secret. Copy `.env.example` and fill it in.

**"My E2E test times out"** — Twilio delivery can take up to 30 seconds.
The default E2E timeout is 120 seconds. If your test still times out, the
problem isn't the timeout — the SMS isn't being delivered, or the webhook
isn't reaching your backend.

---

## What this package does NOT cover

- **Frontend tests.** Those live in `frontend/` and use a different test
  runner.
- **Pure-function unit tests.** Those should live alongside the source in
  `backend/` (e.g., a hypothetical `backend/src/utils/retry.test.ts`).
  Nothing wrong with co-locating tiny unit tests with the code; this package
  exists for HTTP-level integration and E2E scenarios specifically.
- **Performance / load testing.** Different concern, different tooling.
- **Visual regression / UI tests.** N/A — we don't render anything.

---

## Quick reference

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Run CI tier | `npm test` |
| Watch mode | `npm run test:watch` |
| Run E2E tier | `npm run test:e2e` |
| Run both tiers | `npm run test:all` |
| Single file | `npm test -- src/ci/users.test.ts` |
| By test name | `npm test -- -t "creates a viewer"` |
| Typecheck | `npx tsc --noEmit` |

---

## Adding to the suite

The 184-scenario plan in `./backend-test-plan.md` is the menu. Pick a
scenario, write the test using the pattern above, tick the checkbox in the
plan, commit. Most scenarios slot naturally into a `src/ci/<feature>.test.ts`
file alongside related scenarios.
