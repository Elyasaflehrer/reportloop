# Local Development Guide

How to run the ReportLoop backend and frontend together on your machine.

---

## Prerequisites (one-time)

- **Node.js** v18 or higher
- **Redis** — install locally or use a free cloud instance

### Install and start Redis locally

**Linux (WSL):**
```bash
sudo apt install redis-server
sudo service redis-server start
```

**Mac:**
```bash
brew install redis
brew services start redis
```

**Or use Upstash (no install needed):** create a free database at [upstash.com](https://upstash.com) and use the Redis URL they give you.

---

## Step 1 — Backend `.env` file

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in the required values:

### Where to find each value

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Pooled connection** (port 6543) |
| `DATABASE_URL_DIRECT` | Supabase → Project Settings → Database → **Direct connection** (port 5432) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Settings → JWT Secret |
| `REDIS_URL` | `redis://localhost:6379` if running locally, or your Upstash URL |
| `APP_BASE_URL` | `http://localhost:3000` |
| `FRONTEND_ORIGIN` | `http://localhost:8080` |

### Optional (app starts without these, features disabled)

| Variable | Feature it enables |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS sending |
| `ANTHROPIC_API_KEY` | AI-generated report summaries |

### Minimal `.env` for local development (no SMS, no AI)

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
DATABASE_URL_DIRECT=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
REDIS_URL=redis://localhost:6379
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000
FRONTEND_ORIGIN=http://localhost:8080
```

---

## Step 2 — Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

This creates all the tables in your Supabase PostgreSQL database. Run this once, and again any time migrations are added.

---

## Step 3 — Install dependencies and start the backend

```bash
cd backend
npm install
npm run dev
```

You should see:
```
Server listening at http://localhost:3000
```

Confirm it's working by opening `http://localhost:3000/health` in your browser — it should return `{"status":"ok"}`.

---

## Step 4 — Serve the frontend

In a **new terminal** (keep the backend running):

```bash
npx serve /home/elyasaf/workstation/reportloop -l 8080
```

Then open: **`http://localhost:8080/AI_Reporter.html`**

> The frontend must be served over HTTP (not opened as a `file://` URL) because Supabase Auth requires a real URL for redirects.

---

## Step 5 — Supabase dashboard settings (one-time)

Go to your Supabase project → **Authentication → URL Configuration** and set:

- **Site URL:** `http://localhost:8080`
- **Redirect URLs:** add `http://localhost:8080/**`

This is required for password reset and invite emails to redirect back to the app correctly.

---

## Step 6 — Create your first admin user

The database starts empty. You need one admin account to log in.

**Option A — Supabase SQL Editor**

Go to Supabase → SQL Editor and run:
```sql
INSERT INTO users (name, email, role, active)
VALUES ('Your Name', 'your@email.com', 'admin', true);
```

Then go to Supabase → **Authentication → Users → Invite user**, enter that same email. You'll receive an invite email — click the link, set your password, and you're in.

**Option B — Supabase Auth UI + API**

1. Go to Supabase → Authentication → Users → **Add user** → enter email + temporary password
2. Then call the backend to insert the user row:
```bash
# You'll need to get a JWT first (log in via the app or Supabase Auth API)
# Then POST /users with an admin token
```

Option A is simpler for first-time setup.

---

## Daily workflow

Every time you work on the project, start these two processes:

**Terminal 1 — Backend:**
```bash
cd /home/elyasaf/workstation/reportloop/backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
npx serve /home/elyasaf/workstation/reportloop -l 8080
```

Then open `http://localhost:8080/AI_Reporter.html`.

---

## What works right now

| Feature | Status |
|---|---|
| Login | ✅ |
| Forgot password / reset password | ✅ |
| Admin → Add / edit / delete users | ✅ |
| Admin → Invite email sent on user creation | ✅ |
| Admin → Create / edit / delete groups | ✅ |
| Admin → Assign users to groups | ✅ |
| Admin → Assign managers to groups | ✅ |
| Admin → Setup progress checklist | ✅ |
| Manager → Questions | ⏳ UI not yet wired to API (shows empty) |
| Manager → Schedules | ⏳ UI not yet wired to API (shows empty) |
| SMS broadcasts | ✅ Works when Twilio env vars are set |
| AI report summaries | ✅ Works when `ANTHROPIC_API_KEY` is set |

---

## Troubleshooting

**`CORS` error in browser console**
Make sure `FRONTEND_ORIGIN=http://localhost:8080` is set in your `.env` and the backend was restarted after changing it.

**`401 Unauthorized` on API calls**
Your Supabase JWT secret in `.env` doesn't match the one in the Supabase dashboard. Go to Supabase → Project Settings → API → JWT Settings → copy the JWT Secret exactly.

**Password reset link gives `ERR_CONNECTION_REFUSED`**
The Supabase Site URL is pointing to the wrong address. Check Step 5 above.

**`P1001: Can't reach database server`**
Your `DATABASE_URL` is wrong or you're not connected to the internet (Supabase is a hosted database).

**Redis connection error**
Redis isn't running. Start it with `sudo service redis-server start` (Linux) or `brew services start redis` (Mac).
