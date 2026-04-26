# AI Reporter — Backend & Production Readiness Plan

> **Status:** Planning | **Updated:** 2026-04-23 | **Bar:** Enterprise SaaS used by real companies.

---

## 0. Non-Negotiable Rules

- All `*_SEED` constants in `AI_Reporter.html` are presentation-only → deleted during cutover
- Schema designed from business domain, not seed shape
- Access scope derived at query time via joins — never stored
- No secrets in browser, localStorage, or DB
- Twilio is platform-wide (one account, one number, env vars only)
- **Auth (canonical path):** browser signs in via Supabase JS client (`signInWithPassword`); API receives `Authorization: Bearer <jwt>`; server verifies JWT using `SUPABASE_JWT_SECRET` — server never handles passwords. New users are provisioned by admin via `POST /users` → backend calls Supabase Admin API (`inviteUserByEmail`) → user receives invite email → sets own password. Google/Microsoft SSO deferred to v2.
- Never trust `role` or scope from client request payload — always resolve from DB via JWT subject

---

## 1. Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5 |
| Framework | Fastify |
| ORM | Prisma |
| Database | PostgreSQL via Supabase (RLS) |
| Auth | Supabase Auth (JWT) |
| Job Queue | BullMQ + Redis |
| SMS | Twilio Node SDK |
| AI | Anthropic SDK `claude-sonnet-4-6` |
| Validation | Zod |
| Logging | Pino (structured JSON) |
| Error tracking | Sentry |
| Dev infra | Docker Compose |
| Hosting | TBD — deployment-agnostic |

---

## 2. Environments

| Env | Purpose | Supabase | Twilio |
|---|---|---|---|
| dev | Local dev | Separate project | Sandbox |
| staging | Pre-prod verification | Separate project | Test number |
| production | Live | Production project | Real number |

No environment shares credentials with another.

---

## 3. Repository Structure

```
ai_reporter/
├── AI_Reporter.html
├── backend_plan.md
├── backend/
│   ├── src/
│   │   ├── index.ts                  # start server + workers + scheduler
│   │   ├── app.ts                    # Fastify factory: plugins + routes
│   │   ├── config.ts                 # Zod env validation (throws on missing)
│   │   ├── db.ts                     # Prisma singleton
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── groups.ts
│   │   │   ├── schedules.ts
│   │   │   ├── questions.ts
│   │   │   ├── employees.ts
│   │   │   ├── conversations.ts
│   │   │   ├── broadcasts.ts
│   │   │   └── webhooks.ts           # return 200 fast → enqueue job
│   │   ├── services/
│   │   │   ├── sms.service.ts        # buildBundleMessage + length enforcement
│   │   │   ├── twilio.service.ts     # sendSms + validateWebhook
│   │   │   ├── ai.service.ts         # extractAnswers (Claude structured output)
│   │   │   └── broadcast.service.ts  # orchestrates broadcast → conversations
│   │   ├── jobs/
│   │   │   ├── queue.ts              # BullMQ queue definitions
│   │   │   ├── scheduler.ts          # node-cron every minute
│   │   │   ├── broadcast.worker.ts   # runs broadcast per scheduleId
│   │   │   ├── conversation.worker.ts# ping-pong lock → extract → respond
│   │   │   ├── reminder.worker.ts    # every 15 min: nudges + stuck recovery
│   │   │   └── cleanup.worker.ts     # nightly retention cleanup
│   │   ├── middleware/
│   │   │   └── rbac.ts              # authenticate + requireRole
│   │   └── types/index.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts                  # smoke-test data only (not demo data)
│   │   └── migrations/
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── docker-compose.yml
└── Dockerfile
```

---

## 4. Database Schema

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id         Int      @id @default(autoincrement())
  supabaseId String?  @unique
  name       String
  email      String   @unique
  phone      String?
  initials   String?
  title      String?
  role       Role
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  // scope derived via joins — no denormalized fields
  groupMemberships GroupMember[]
  managerGroups    ManagerGroup[]
  questions        Question[]
  schedules        Schedule[]
}

enum Role { admin manager viewer participant }

model Employee {
  id          Int      @id @default(autoincrement())
  name        String
  phone       String   @unique
  property    String?
  active      Boolean  @default(true)
  smsOptedOut Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // no managerId — scope derived from group membership
  groupMemberships GroupMember[]
  scheduleTargets  ScheduleEmployee[]
  conversations    Conversation[]
}

model Group {
  id          Int      @id @default(autoincrement())
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  members       GroupMember[]
  managerGroups ManagerGroup[]
}

model GroupMember {
  id         Int       @id @default(autoincrement())
  groupId    Int
  userId     Int?
  employeeId Int?
  group    Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user     User?     @relation(fields: [userId], references: [id], onDelete: Cascade)
  employee Employee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  @@unique([groupId, userId])
  @@unique([groupId, employeeId])
  @@index([userId])
  @@index([employeeId])
}

model ManagerGroup {
  managerId Int
  groupId   Int
  manager User  @relation(fields: [managerId], references: [id], onDelete: Cascade)
  group   Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([managerId, groupId])
  @@index([managerId])
}

model Question {
  id        Int      @id @default(autoincrement())
  managerId Int
  text      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  manager           User               @relation(fields: [managerId], references: [id], onDelete: Cascade)
  scheduleQuestions ScheduleQuestion[]
  answers           Answer[]
}

model Schedule {
  id            Int           @id @default(autoincrement())
  managerId     Int
  label         String?
  dayOfWeek     DayOfWeek
  timeOfDay     String        // "HH:MM" 24h
  timezone      String        // IANA e.g. "America/New_York"
  active        Boolean       @default(true)
  recipientMode RecipientMode
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  manager    User               @relation(fields: [managerId], references: [id], onDelete: Cascade)
  employees  ScheduleEmployee[]
  questions  ScheduleQuestion[]
  broadcasts Broadcast[]
}

enum DayOfWeek { Sunday Monday Tuesday Wednesday Thursday Friday Saturday }
enum RecipientMode { all subset }

model ScheduleEmployee {
  scheduleId Int
  employeeId Int
  schedule Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  @@id([scheduleId, employeeId])
}

model ScheduleQuestion {
  scheduleId Int
  questionId Int
  schedule Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  question Question @relation(fields: [questionId], references: [id], onDelete: Cascade)
  @@id([scheduleId, questionId])
}

model Broadcast {
  id          Int             @id @default(autoincrement())
  scheduleId  Int
  fireDate    String          // "YYYY-MM-DD" in schedule.timezone — dedup key
  status      BroadcastStatus @default(pending)
  triggeredAt DateTime        @default(now())
  triggeredBy Int?            // userId if manual trigger
  schedule      Schedule       @relation(fields: [scheduleId], references: [id])
  conversations Conversation[]
  @@unique([scheduleId, fireDate]) // DB-level dedup: one broadcast per schedule per calendar day
  @@index([scheduleId, triggeredAt])
}

enum BroadcastStatus { pending in_progress completed failed }

model Conversation {
  id            Int                @id @default(autoincrement())
  broadcastId   Int
  employeeId    Int
  status        ConversationStatus @default(pending)
  occupancy     Int?
  startedAt     DateTime?
  completedAt   DateTime?
  failedAt      DateTime?
  failReason    String?
  lastMessageAt DateTime?
  remindersSent Int                @default(0)
  broadcast Broadcast @relation(fields: [broadcastId], references: [id])
  employee  Employee  @relation(fields: [employeeId], references: [id])
  messages  Message[]
  answers   Answer[]
  @@index([employeeId, status])
  @@index([status])
  @@index([lastMessageAt])
}

enum ConversationStatus {
  pending        // not yet sent
  awaiting_reply // AI just sent — employee's turn
  processing     // employee replied — AI's turn (atomic lock)
  completed
  timed_out
  superseded
  failed
}

model Message {
  id             Int         @id @default(autoincrement())
  conversationId Int
  role           MessageRole
  body           String
  sentAt         DateTime    @default(now())
  twilioSid      String?     @unique // webhook idempotency — duplicate delivery = skip
  conversation Conversation @relation(fields: [conversationId], references: [id])
}

enum MessageRole { ai participant }

model Answer {
  id             Int      @id @default(autoincrement())
  conversationId Int
  questionId     Int
  answer         String   // confident answers only — no uncertain rows stored
  createdAt      DateTime @default(now())
  conversation Conversation @relation(fields: [conversationId], references: [id])
  question     Question     @relation(fields: [questionId], references: [id])
  @@unique([conversationId, questionId])
  @@index([conversationId])
}

// Every inbound SMS that was rejected (out-of-turn, closed session, opt-out)
model InboundAuditLog {
  id             Int      @id @default(autoincrement())
  fromPhone      String
  body           String
  conversationId Int?
  reason         String   // OUT_OF_TURN | SESSION_CLOSED | OPT_OUT | NO_CONVERSATION
  receivedAt     DateTime @default(now())
}
```

---

## 4.2 Access Scope (Derived at Query Time)

| Role | Scope |
|---|---|
| admin | Global — no filter |
| manager | `ManagerGroup WHERE managerId=me` → group IDs → scoped data |
| viewer | `GroupMember WHERE userId=me` → group IDs → manager IDs → read-only |
| participant | `Conversation WHERE employeeId=myPhone` only |

---

## 5. API Endpoints

Base: `/api/v1` — All `GET` lists accept `?page=1&limit=50&sortBy=&sortDir=` and endpoint-specific filters.

| Method | Path | Role | Notes / Filters |
|---|---|---|---|
| POST | `/auth/logout` | any | invalidate Supabase session (client-side) |
| GET | `/auth/me` | any | current user + server-derived scope (from JWT subject → DB) |
| GET | `/admin/setup-status` | admin | group count, manager-group links, membership count, viewer coverage |
| GET | `/users` | admin | `?role= ?groupId= ?active= ?search=` |
| POST | `/users` | admin | |
| GET | `/users/:id` | admin | |
| PATCH | `/users/:id` | admin | |
| DELETE | `/users/:id` | admin | |
| GET | `/groups` | admin, manager | |
| POST | `/groups` | admin | |
| PATCH | `/groups/:id` | admin | |
| DELETE | `/groups/:id` | admin | |
| GET | `/groups/:id/members` | admin, manager | |
| POST | `/groups/:id/members` | admin | |
| DELETE | `/groups/:id/members/:mid` | admin | |
| GET | `/manager-groups` | admin | |
| POST | `/manager-groups` | admin | |
| DELETE | `/manager-groups/:mid/:gid` | admin | |
| GET | `/employees` | admin, manager | |
| POST | `/employees` | admin | |
| PATCH | `/employees/:id` | admin, manager | |
| DELETE | `/employees/:id` | admin | |
| GET | `/managers/:id/questions` | manager (own), admin | |
| POST | `/managers/:id/questions` | manager (own) | validates projected SMS length |
| PATCH | `/managers/:id/questions/:qid` | manager (own) | |
| DELETE | `/managers/:id/questions/:qid` | manager (own) | |
| GET | `/managers/:id/schedules` | manager (own), admin | |
| POST | `/managers/:id/schedules` | manager (own) | |
| PATCH | `/managers/:id/schedules/:sid` | manager (own) | |
| DELETE | `/managers/:id/schedules/:sid` | manager (own) | |
| GET | `/broadcasts` | manager, admin | scoped |
| POST | `/broadcasts/trigger` | admin | manual trigger |
| POST | `/broadcasts/:id/retry` | admin | re-trigger failed |
| GET | `/broadcasts/:id` | manager, admin | detail + conversations |
| GET | `/conversations` | manager, viewer, admin | `?broadcastId= ?employeeId= ?status=` |
| GET | `/conversations/:id` | manager, viewer, admin | |
| GET | `/conversations/:id/messages` | manager, viewer, admin | |
| GET | `/conversations/:id/answers` | manager, viewer, admin | |
| POST | `/webhooks/twilio` | public (sig-validated) | inbound SMS |
| GET | `/health` | public | DB + Redis + uptime |

---

## 6. Conversation Flow

**Design:** One bundled SMS with all questions → employee replies freely → Claude extracts answers. Strict ping-pong order enforced by Conversation status.

### 6.1 SMS Bundle (`sms.service.ts`)

- Builds a friendly, human-tone message with all questions numbered:
  ```
  Hey [name], quick check-in this week:
  1. How many rooms are occupied tonight?
  2. Any maintenance issues to flag?
  3. How's the team morale this week?
  Just reply with your answers — no need to be formal!
  ```
- Hard-blocks if `message.length > SMS_MAX_LENGTH` → `failReason=SMS_TOO_LONG`, Sentry alert
- Question save API pre-validates: warn at 80% of limit, error at 100%
- `SMS_MAX_LENGTH` default: `459` (3 SMS segments)

### 6.2 Broadcast Dispatch

```
scheduler.ts (node-cron, every minute)
  → query due schedules (dayOfWeek + timeOfDay in schedule.timezone)
  → dedup: skip if broadcast exists for this scheduleId in last 23h
  → broadcastQueue.add('run', { scheduleId })

broadcast.worker.ts
  → create Broadcast (in_progress)
  → for each target employee:
      → check smsOptedOut → skip if true
      → supersede any open conversation (status=superseded, reason=SUPERSEDED_BY_NEW_BROADCAST)
      → buildBundleMessage → enforce length
      → create Conversation (awaiting_reply, lastMessageAt=now)
      → sendSms → save Message (role=ai)
```

### 6.3 Outbound Send (`twilio.service.ts → sendSms`)

```
client.messages.create({
  to: employee.phone,
  from: TWILIO_FROM_NUMBER,
  body: bundleMessage,
  statusCallback: `${APP_BASE_URL}/webhooks/twilio`  // required for delivery failure callbacks
})
→ save Message(role=ai, twilioSid=response.sid)
```

### 6.4 Inbound Webhook (`webhooks.ts`)

```
POST /webhooks/twilio
  → validateSignature → 403 if invalid
  → return 200 immediately (prevents Twilio retries)

  [Branch on request type]
  → has Body param?             → INBOUND SMS flow
  → has MessageStatus (no Body)? → STATUS CALLBACK flow

  [INBOUND SMS]
  → STOP   → Employee.smsOptedOut=true, close open conversation → done
  → UNSTOP → smsOptedOut=false → done
  → idempotency: if Message.twilioSid already exists → skip (Twilio retry)
  → lookup Conversation by Employee.phone=From
  → PING-PONG LOCK (atomic):
      UPDATE conversations SET status='processing'
      WHERE id=? AND status='awaiting_reply'
    rows=1 → save Message(role=participant, twilioSid=SmsSid) → enqueue conversation job
    rows=0 → InboundAuditLog(OUT_OF_TURN or SESSION_CLOSED)
             if closed → send courtesy SMS "Session closed. Next one coming on schedule."

  [STATUS CALLBACK — MessageStatus=failed|undelivered]
  → lookup Message by twilioSid
  → mark Conversation.status=failed, failReason=TWILIO_DELIVERY_FAILED
  → Sentry alert
```

### 6.5 Extraction Job (`conversation.worker.ts`)

```
  → concatenate all unprocessed participant Messages (handles split replies)
  → ai.service.ts extractAnswers(questions, combinedText)
      → Claude structured output: [{ questionId, answer|null }]
      → store Answer rows for confident matches only
  → answers found → Conversation=completed, extract occupancy
      → check if ALL Broadcast Conversations are terminal (completed/timed_out/superseded/failed)
        → yes → Broadcast.status=completed
  → 0 answers (e.g. "I'm busy") →
      send: "Got it! Please reply with your answers when ready."
      save Message(role=ai)
      reset Conversation → awaiting_reply
```

### 6.6 Claude Extraction Prompt

```
You are extracting answers from an SMS reply sent by a hotel property manager.

Questions asked:
{{numberedQuestionList}}

Employee reply:
"{{combinedText}}"

Return JSON: { "answers": [{ "questionId": n, "answer": "string or null" }] }
Rules: match by number or context; null if missing or unclear; never invent; occupancy = integer/percent.
```

### 6.7 Reminder + Recovery Checker (`reminder.worker.ts`, every 15 min)

```
REMINDERS — conversations WHERE status=awaiting_reply:
  if lastMessageAt > REMINDER_INTERVAL ago AND remindersSent < REMINDER_COUNT:
    → send nudge SMS, save as Message(role=ai), remindersSent++, lastMessageAt=now
  if remindersSent >= REMINDER_COUNT AND lastMessageAt > REMINDER_INTERVAL ago:
    → status=timed_out, failReason=NO_RESPONSE, Sentry alert

STUCK RECOVERY — conversations WHERE status=processing
                 AND lastMessageAt < now - STUCK_TIMEOUT:
  → reset to awaiting_reply, Sentry alert (signals crash)
```

---

## 7. Retry & Failure Policy

| Env Var | Default | Description |
|---|---|---|
| `BROADCAST_RETRY_COUNT` | `3` | BullMQ retries per job |
| `BROADCAST_RETRY_DELAY_MS` | `60000` | Base delay; exponential backoff applied |
| `BROADCAST_CONCURRENCY` | `5` | Simultaneous broadcast jobs |

After all retries: Broadcast + Conversations → `failed`, `failReason` stored, Sentry alert.  
Admin re-triggers via `POST /broadcasts/:id/retry`.

---

## 8. Retention Policy

| Env Var | Default | Description |
|---|---|---|
| `CONVERSATION_RETENTION_DAYS` | `0` | 0 = keep forever; N = delete after N days |

`cleanup.worker.ts` runs nightly. Hard vs soft delete: Open Decision (see §14).

---

## 9. Security

| Concern | Solution |
|---|---|
| Auth | Supabase JWT; verified server-side every request |
| Twilio credentials | Env vars only; never in DB or API responses |
| Twilio webhook | `twilio.validateRequest()` on every inbound; 403 if invalid |
| Twilio STOP | `smsOptedOut=true` on STOP; no SMS until UNSTOP — legally required |
| Multi-tenant | Supabase RLS + Prisma scope filters — both layers mandatory |
| Rate limiting | `@fastify/rate-limit` on `/auth/*` and `/broadcasts/trigger` |
| CORS | Locked to production origin per environment |
| Input validation | Zod on all request bodies + path params |
| DB connection pooling | Prod `DATABASE_URL` → Supabase PgBouncer; `DATABASE_URL_DIRECT` for migrations |

---

## 10. Error Handling

All errors return `{ error: { code, message, requestId } }`. No stack traces to client.

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod rejection |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Wrong role or out-of-scope |
| 404 | `RESOURCE_NOT_FOUND` | |
| 409 | `CONFLICT` | Duplicate |
| 429 | `RATE_LIMITED` | |
| 500 | `INTERNAL_ERROR` | Unhandled server error |
| 503 | `SERVICE_UNAVAILABLE` | DB or Redis down |

4xx → log `warn`; 5xx → log `error` + Sentry. Every request gets a `requestId` in headers + logs.

---

## 11. Observability

- **Pino:** structured JSON; every line includes `requestId`, `userId`, `role`, `method`, `url`, `statusCode`, `responseTime`
- **Log levels:** `debug` in dev, `info` in staging/prod
- **Sentry:** unhandled exceptions + failed broadcasts + stuck-conversation alerts
- **`GET /health`:** `{ status, db, redis, uptime }` — 503 if any dependency down
- **Slow queries:** log queries > 500ms in prod
- **Log aggregation:** TBD (see Open Decisions)

---

## 12. Environment Variables

```bash
# Database (prod: PgBouncer URL; migrations use DATABASE_URL_DIRECT)
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_reporter
DATABASE_URL_DIRECT=postgresql://user:pass@localhost:5432/ai_reporter

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret

# Twilio (platform-wide)
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_FROM_NUMBER=+15551234567

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxxx

# Redis
REDIS_URL=redis://localhost:6379

# SMS
SMS_MAX_LENGTH=459

# Broadcast
BROADCAST_RETRY_COUNT=3
BROADCAST_RETRY_DELAY_MS=60000
BROADCAST_CONCURRENCY=5

# Conversation lifecycle
CONVERSATION_REMINDER_COUNT=2
CONVERSATION_REMINDER_INTERVAL_MINUTES=60
CONVERSATION_STUCK_TIMEOUT_MINUTES=10

# Retention (0 = keep forever)
CONVERSATION_RETENTION_DAYS=0

# App
PORT=3000
APP_BASE_URL=https://your-domain.com   # used for Twilio statusCallback URL
FRONTEND_ORIGIN=https://your-domain.com
NODE_ENV=development
```

---

## 13. Dependencies

```json
{
  "scripts": {
    "build": "tsc --outDir dist",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts",
    "test": "vitest"
  },
  "dependencies": {
    "fastify": "^4",
    "@fastify/cors": "^9",
    "@fastify/rate-limit": "^9",
    "@fastify/static": "^7",
    "@prisma/client": "^5",
    "bullmq": "^5",
    "ioredis": "^5",
    "node-cron": "^3",
    "twilio": "^5",
    "@anthropic-ai/sdk": "^0.30",
    "@supabase/supabase-js": "^2",
    "zod": "^3",
    "dotenv": "^16",
    "@sentry/node": "^8"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "prisma": "^5",
    "@types/node": "^20",
    "@types/node-cron": "^3",
    "vitest": "^1",
    "@vitest/coverage-v8": "^1"
  }
}
```

---

## 14. Docker Compose

```yaml
services:
  api:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [db, redis]
    volumes: ["./backend/src:/app/src"]
    command: npx tsx watch src/index.ts
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: ai_reporter, POSTGRES_USER: user, POSTGRES_PASSWORD: pass }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
volumes:
  pgdata:
```

---

## 15. Frontend Integration (`AI_Reporter.html`)

Migration order (verify parity per domain before proceeding):
1. Auth hydration → `GET /auth/me`, `POST /auth/logout`
2. Users + Groups + Manager Groups
3. Employees
4. Questions + Schedules
5. Conversations / history reads
6. Broadcast trigger + status polling (`GET /broadcasts/:id` every 5s)
7. Cleanup: delete all `*_SEED` constants, localStorage migrations, demo-only paths

Rules: `const USE_API = false` flag, flip per domain. JWT in memory only. Every error surfaces a visible message. Silent failures forbidden.

---

## 16. Implementation Phases

### Phase 1 — Foundation
- [ ] Fastify + TypeScript + Prisma + Zod + Pino + dotenv scaffold
- [ ] Docker Compose running (API + PostgreSQL + Redis)
- [ ] Full schema migrated, smoke-test seed applied
- [ ] `config.ts` — throws on startup if any required env var missing
- [ ] `GET /health`
- [ ] Auth endpoints via Supabase Auth
- [ ] `authenticate` + `requireRole` preHandlers
- [ ] Sentry wired up
- [ ] Graceful shutdown: `SIGTERM` → drain workers → close Prisma → stop Fastify

### Phase 2 — CRUD APIs
- [ ] Users, Groups, GroupMembers, ManagerGroups, Employees CRUD
- [ ] `POST /users` calls `supabase.auth.admin.inviteUserByEmail(email)` → user receives invite email to set their own password
- [ ] Questions + Schedules CRUD (with sub-tables, SMS length pre-validation)
- [ ] Consistent error shape on all routes; pagination on all lists

### Phase 3 — Broadcast Engine
- [ ] `sms.service.ts`: `buildBundleMessage()` + length enforcement
- [ ] `twilio.service.ts`: `sendSms()`, `validateWebhook()`
- [ ] `ai.service.ts`: `extractAnswers()` structured output
- [ ] `broadcast.service.ts`: full orchestration
- [ ] BullMQ workers: `broadcast.worker.ts`, `conversation.worker.ts`
- [ ] `scheduler.ts`: node-cron, dedup, timezone-aware firing
- [ ] `reminder.worker.ts`: nudge ladder + stuck-conversation recovery
- [ ] `POST /broadcasts/trigger`, `POST /broadcasts/:id/retry`

### Phase 4 — Webhooks & Conversations
- [ ] `POST /webhooks/twilio`: return 200 fast → STOP/UNSTOP → ping-pong lock → enqueue
- [ ] `conversation.worker.ts`: concatenate → extract → complete or acknowledge
- [ ] 0-answer acknowledgment SMS (`role=ai`) + reset to `awaiting_reply`
- [ ] `InboundAuditLog` for out-of-turn / closed-session messages
- [ ] Courtesy SMS for replies to closed sessions
- [ ] `GET /admin/setup-status`
- [ ] Conversations + Messages + Answers read endpoints
- [ ] Nightly retention cleanup job

### Phase 5 — Frontend Cutover
- [ ] `USE_API` flag + domain-by-domain migration
- [ ] Parity verified per domain
- [ ] All seed / localStorage / demo code deleted
- [ ] `AI_Reporter.html` served via `@fastify/static`

### Phase 6 — Production Hardening
- [ ] Supabase RLS policies verified by security tests
- [ ] Rate limiting per environment
- [ ] CORS locked per environment
- [ ] Structured logging verified in staging
- [ ] Sentry alerts: failed broadcasts, 5xx spikes, health failures, stuck conversations
- [ ] Backup & restore drill
- [ ] CI/CD pipeline live (see Open Decisions)
- [ ] Staging smoke-tested end to end
- [ ] UI/UX signoff gates passed
- [ ] Rollback tested in staging

---

## 17. Critical Files

| File | Purpose |
|---|---|
| `src/index.ts` | Start server + all workers + scheduler |
| `src/app.ts` | Fastify factory: plugins, routes, error handler |
| `src/config.ts` | Zod env — throws on startup if missing |
| `src/db.ts` | Prisma singleton |
| `src/middleware/rbac.ts` | `authenticate` + `requireRole` |
| `src/services/sms.service.ts` | Bundle builder + hard length enforcement |
| `src/services/ai.service.ts` | `extractAnswers()` — structured Claude output |
| `src/services/twilio.service.ts` | `sendSms()`, `validateWebhook()` |
| `src/services/broadcast.service.ts` | Broadcast orchestration |
| `src/jobs/scheduler.ts` | node-cron: timezone-aware, dedup, enqueue |
| `src/jobs/broadcast.worker.ts` | BullMQ: run broadcast per scheduleId |
| `src/jobs/conversation.worker.ts` | Ping-pong lock → extract → complete or acknowledge |
| `src/jobs/reminder.worker.ts` | Nudge ladder + stuck recovery |
| `src/jobs/cleanup.worker.ts` | Nightly retention |
| `src/routes/webhooks.ts` | 200 fast → validate → ping-pong → enqueue |
| `prisma/schema.prisma` | Full schema |
| `prisma/seed.ts` | Smoke-test data only |

---

## 18. UI/UX Production Signoff Gates

All must pass before Phase 6 completes. Any critical failure = NO-GO.

| Gate | Criteria |
|---|---|
| A — Responsiveness | No overlap/clipping at 1366/1280/1024/768px and 100/125/150% zoom |
| B — Keyboard operability | Full task completion via keyboard; focus always visible; modal: trap + Escape + return |
| C — Accessibility semantics | All controls labelled; dynamic updates announced; table semantics valid |
| D — Feedback clarity | No silent failures; every mutation produces visible feedback |
| E — Consistency | Interaction patterns consistent across admin/manager/history |

Known failure: Gate C — tracked in `uiux_signoff_report.md`.

---

## 19. Backup & Restore

- Supabase daily automated backups on staging + prod
- Point-in-time recovery enabled on prod
- Restore drill required before go-live
- Redis is ephemeral — BullMQ retries handle lost in-flight jobs; no business data in Redis

---

## 20. Rollback Plan

| Scenario | Action |
|---|---|
| Bad API deploy | Re-deploy previous image/SHA via hosting platform |
| Bad DB migration | `prisma migrate resolve --rolled-back`; restore from backup if data mutated |
| Broken frontend | Revert `AI_Reporter.html`; `USE_API` flag allows per-domain fallback |
| Failed Twilio | Disable active schedules via admin UI; fix config; re-enable |

Rollback must be tested in staging before prod go-live.

---

## 21. Privacy & GDPR (Post-Launch)

Noted, not required at launch: right to erasure, data export, privacy policy, SMS consent documentation.

---

## 22. Open Decisions

| Decision | Options | Deadline |
|---|---|---|
| Production hosting | Render, Railway, Fly.io, self-hosted | Before Phase 6 |
| CI/CD platform | GitHub Actions, platform-native | Before Phase 6 |
| Log aggregation | Logtail, Datadog, platform native | Before Phase 6 |
| Hard vs soft delete | Hard delete vs `deletedAt` | Before Phase 4 |
| Twilio voice | SMS only vs voice from day 1 | Before Phase 3 |
| Privacy & GDPR | Right to erasure, data export, privacy policy, SMS consent copy | Post-launch |

---

## 23. Definition of Production Ready

All must be true before go-live:

- [ ] Backend is source of truth for all business domains
- [ ] All CRUD calls real API endpoints; no localStorage authority
- [ ] All `*_SEED` and localStorage code deleted from frontend
- [ ] Auth + RBAC enforced at route layer and RLS — verified by tests
- [ ] Full broadcast loop: schedule fires → SMS → employee replies → extraction → stored
- [ ] Ping-pong enforced: employee can only reply after AI sends; out-of-turn messages to audit log
- [ ] 0-answer replies handled: acknowledgment sent, conversation stays open
- [ ] Stuck conversations auto-recovered via `CONVERSATION_STUCK_TIMEOUT_MINUTES`
- [ ] Failed broadcasts retry automatically; admin can re-trigger
- [ ] Retry + timing + retention configurable via env vars only
- [ ] Twilio STOP/UNSTOP handled correctly
- [ ] Paginated list endpoints — no unbounded queries
- [ ] Schedule timezone field set — broadcasts fire at correct local time
- [ ] Structured logs with `requestId` on every line
- [ ] Sentry capturing errors + alerting on broadcast failures and stuck conversations
- [ ] `GET /health` returns correct DB + Redis status
- [ ] All five UI/UX signoff gates pass with evidence
- [ ] Backup verified via restore drill
- [ ] Rollback tested in staging
- [ ] Staging smoke-tested end to end before prod deploy
- [ ] PgBouncer pooling confirmed in staging + prod
- [ ] Graceful shutdown verified — no jobs cut off on deploy

---

## 24. Testing

- **Unit:** each service with mocked Twilio + Anthropic clients
- **Route:** `fastify.inject()` — auth, RBAC, happy path, validation rejection per endpoint
- **Security:** manager A cannot read manager B's data; viewer cannot mutate; participant sees only own conversation
- **Integration:** `docker compose up` → seed → login → create schedule → trigger → assert DB rows + Twilio mock called
- **Webhook:** `ngrok` + Twilio sandbox → real inbound SMS → conversation advances
- **Ping-pong:** employee sends 2 simultaneous messages → only first processed, second in audit log
- **Non-answer:** employee replies "I'm busy" → 0 answers → acknowledgment sent → back to `awaiting_reply`
- **Stuck recovery:** set conversation to `processing` → wait > `CONVERSATION_STUCK_TIMEOUT_MINUTES` → verify reset + Sentry
- **Closed-session reply:** reply after timeout → audit log + courtesy SMS
- **STOP compliance:** reply STOP → no further SMS; UNSTOP → resumes
- **Timezone:** non-UTC schedule → fires at correct local time
- **Pagination:** 500+ users → `GET /users` returns paginated results
- **Retention:** seed old conversations → run cleanup → rows deleted per policy
- **Graceful shutdown:** SIGTERM mid-broadcast → job completes cleanly, no half-written rows
- **Rollback:** deploy to staging → restore → revert → service recovers

---

*Check off phase tasks and update Status as implementation progresses.*

