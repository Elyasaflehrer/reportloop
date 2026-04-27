# Local Development Guide

How to run the ReportLoop backend and frontend together on your machine.

---

## Prerequisites (one-time)

- **Node.js** v18 or higher
- **Redis** — Docker container, local install, or a free cloud instance

### Start Redis (this project uses Docker)

```bash
docker run -d --name reportloop-redis -p 6379:6379 redis:alpine
```

If the container already exists, just start it:
```bash
docker start reportloop-redis
```

**Alternative — local install (Linux/WSL):**
```bash
sudo apt install redis-server
sudo service redis-server start
```

**Alternative — Upstash (no install needed):** create a free database at [upstash.com](https://upstash.com) and use the Redis URL they give you.

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
| `FRONTEND_ORIGIN` | `http://localhost:8081` (Vite falls back to 8081 if 8080 is taken) |

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
FRONTEND_ORIGIN=http://localhost:8081
```

> **Note:** Vite is configured for port 8080 but falls back to 8081 if 8080 is already in use on this machine. Check which port Vite actually started on and make sure `FRONTEND_ORIGIN` matches, then restart the backend.

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

## Step 4 — Start the frontend (Vite dev server)

In a **new terminal** (keep the backend running):

```bash
cd frontend
npm run dev
```

Vite will print the actual URL it started on — it's usually `http://localhost:8081` on this machine because port 8080 is already in use.

> Vite proxies API calls to `http://localhost:3000` automatically. Make sure `FRONTEND_ORIGIN` in `backend/.env` matches the port Vite picked, then restart the backend.

---

## Step 5 — Supabase dashboard settings (one-time)

Go to your Supabase project → **Authentication → URL Configuration** and set:

- **Site URL:** `http://localhost:8081`
- **Redirect URLs:** add `http://localhost:8081/**`

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
cd /home/elyasaf/workstation/reportloop/frontend
npm run dev
```

Then open the URL Vite prints in the terminal (typically `http://localhost:8081` on this machine).

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
`FRONTEND_ORIGIN` in `backend/.env` must match the port Vite is actually running on (check the terminal — it's `8081` on this machine if `8080` is taken). Restart the backend after changing it.

**`401 Unauthorized` on API calls**
Your Supabase JWT secret in `.env` doesn't match the one in the Supabase dashboard. Go to Supabase → Project Settings → API → JWT Settings → copy the JWT Secret exactly.

**Password reset link gives `ERR_CONNECTION_REFUSED`**
The Supabase Site URL is pointing to the wrong address. Check Step 5 above.

**`P1001: Can't reach database server`**
Your `DATABASE_URL` is wrong or you're not connected to the internet (Supabase is a hosted database).

**Redis connection error**
Start the Docker container: `docker start reportloop-redis`. If it doesn't exist yet, run `docker run -d --name reportloop-redis -p 6379:6379 redis:alpine`.
