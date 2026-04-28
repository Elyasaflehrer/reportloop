# Local Development Guide

Two ways to run ReportLoop on your machine. Pick the one that fits your goal:

| | Option A — Node directly | Option B — Docker container |
|---|---|---|
| **Best for** | Daily development | Testing the production image before deploying |
| **Hot reload** | Yes | No |
| **Speed** | Fast startup | ~1–2 min first build |
| **Feels like** | Development | Production |

---

# Option A — Run with Node (daily development)

## Prerequisites

- **Node.js** v20 or higher
- **Redis** running locally

### Start Redis

```bash
# First time
docker run -d --name reportloop-redis -p 6379:6379 redis:alpine

# Already created, just start it
docker start reportloop-redis
```

> **No Docker?** Install Redis directly:
> ```bash
> sudo apt install redis-server && sudo service redis-server start
> ```
> Or use a free cloud instance at [upstash.com](https://upstash.com).

---

## Step 1 — Set up the backend `.env`

```bash
cd backend
cp .env.example .env
```

Fill in the required values:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Pooled connection** (port 6543) |
| `DATABASE_URL_DIRECT` | Supabase → Project Settings → Database → **Direct connection** (port 5432) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Settings → JWT Secret |
| `REDIS_URL` | `redis://localhost:6379` |
| `APP_BASE_URL` | `http://localhost:3000` |
| `FRONTEND_ORIGIN` | `http://localhost:8081` |

**Optional — app starts without these, features just disabled:**

| Variable | Enables |
|---|---|
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | SMS sending |
| `ANTHROPIC_API_KEY` | AI answer extraction |

**Minimal `.env` to get started (no SMS, no AI):**

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

---

## Step 2 — Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

Creates all tables in Supabase. Run once, and again whenever new migrations are added.

---

## Step 3 — Start the backend

```bash
cd backend
npm install
npm run dev
```

Expected output:
```
Server listening at http://localhost:3000
```

Confirm: open `http://localhost:3000/health` — should return `{"status":"ok"}`.

---

## Step 4 — Start the frontend

In a **new terminal** (keep the backend running):

```bash
cd frontend
npm run dev
```

Vite prints the URL — usually `http://localhost:8081` on this machine (port 8080 is already in use).

> Vite proxies all API calls to `http://localhost:3000` automatically. If `FRONTEND_ORIGIN` in `backend/.env` doesn't match the port Vite picked, update it and restart the backend.

---

## Step 5 — Supabase settings (one-time)

Go to Supabase → **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:8081`
- **Redirect URLs:** add `http://localhost:8081/**`

Required for password reset and invite emails to redirect correctly.

---

## Step 6 — Create your first admin user

The database starts empty. You need one admin account to log in.

Go to Supabase → SQL Editor and run:

```sql
INSERT INTO users (name, email, role, active)
VALUES ('Your Name', 'your@email.com', 'admin', true);
```

Then go to Supabase → **Authentication → Users → Invite user**, enter the same email. Click the link in the invite email, set your password, and you're in.

---

## Daily workflow

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open the URL Vite prints (typically `http://localhost:8081`).

---

---

# Option B — Run as a Docker container (pre-deploy testing)

Use this when you want to test the exact image that will run on Cloud Run — compiled TypeScript, `NODE_ENV=production`, no hot reload. Catches any build or configuration issues before pushing to GCP.

## Prerequisites

- **Docker** installed and running
- A filled-in `backend/.env` file (see Option A → Step 1 above)
- **Redis running on the host machine** — the container needs to reach it

Start Redis if it's not already running:
```bash
# First time
docker run -d --name reportloop-redis -p 6379:6379 redis:alpine

# Already created
docker start reportloop-redis
```

> The container can't use `redis://localhost:6379` by default because `localhost` inside a container refers to the container itself, not your machine. Step 2 below covers how to fix this.

---

## Step 1 — Build the image

Run from the **project root**. The Dockerfile lives in `docker/` but needs `backend/` as its build context:

```bash
docker build -t reportloop-backend ./backend
```

What happens inside:
1. Install all dependencies
2. Generate Prisma client
3. Compile TypeScript → `dist/`
4. Build a clean runtime image with prod-only dependencies

First build takes ~1–2 minutes. Subsequent builds are faster thanks to Docker layer caching.

---

## Step 2 — Redis networking

Inside a container, `localhost` means the container itself — not your machine. Use `host.docker.internal` to reach Redis running on your machine.

On **Mac / Docker Desktop for Windows** this works automatically. On **WSL2 / Linux** the `--add-host` flag below enables it.

---

## Step 3 — Run the container

```bash
docker run -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  --env-file backend/.env \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  reportloop-backend
```

The `-e REDIS_URL` overrides the value in `.env` so the container reaches your machine's Redis. Your `.env` keeps `redis://localhost:6379` for Option A.

Logs will appear as plain JSON (no colours — that's expected in production mode).

---

## Step 4 — Verify it works

```bash
curl http://localhost:3000/health
```

Expected:
```json
{ "status": "ok", "db": "ok", "redis": "ok", "uptime": 5.2 }
```

If `db` or `redis` shows `"error"` — check your `.env` values and that Redis is running.

---

## Useful commands

```bash
# List running containers
docker ps

# Stop the container
docker stop <container-id>

# Rebuild after code changes
docker build -t reportloop-backend ./backend

# Override a single env var without editing .env
docker run -p 3000:3000 --add-host=host.docker.internal:host-gateway --env-file backend/.env -e REDIS_URL=redis://host.docker.internal:6379 -e LOG_LEVEL=debug reportloop-backend
```

---

---

# Frontend

The frontend is a React + Vite SPA. Two ways to run it locally:

| | Option A — Vite dev server | Option B — Production preview |
|---|---|---|
| **Best for** | Daily development | Testing the production build before deploying |
| **Hot reload** | Yes | No |
| **Env vars** | Read at runtime | Baked into the bundle at build time |
| **Feels like** | Development | Firebase Hosting |

> Both options require the backend to be running first (Option A or B above).

---

## Frontend Prerequisites (one-time)

```bash
cd frontend
cp .env.example .env
```

Fill in the three values:

| Variable | Where to find it |
|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000` (your local backend) |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` key |

---

## Frontend Option A — Vite Dev Server (daily development)

```bash
cd frontend
npm install
npm run dev
```

Vite starts on port **8080** and falls back to **8081** if 8080 is already in use. It will print the exact URL.

- Hot reload is on — changes appear instantly in the browser
- API calls go directly to `VITE_API_BASE_URL` (`http://localhost:3000`)
- Make sure `FRONTEND_ORIGIN` in `backend/.env` matches the port Vite picked, then restart the backend

---

## Frontend Option B — Production Build Preview

Use this to test the exact bundle that gets deployed to Firebase Hosting — env vars baked in, no hot reload, served statically.

**Step 1 — Build the bundle:**

```bash
cd frontend
npm run build
```

Vite compiles and bundles everything into `dist/`. The `VITE_*` values from `.env` are baked into the JS at this point.

**Step 2 — Serve the bundle:**

```bash
npm run preview
```

Vite serves `dist/` on `http://localhost:4173`. Open that URL in the browser.

> If you change any env var after building, you must run `npm run build` again — the old values are already baked into the bundle.

---

---

# Troubleshooting

**`CORS` error in browser console**
`FRONTEND_ORIGIN` in `backend/.env` doesn't match the port Vite started on. Check the Vite terminal output and update accordingly, then restart the backend.

**`401 Unauthorized` on API calls**
The `SUPABASE_JWT_SECRET` in `.env` doesn't match the Supabase dashboard value. Go to Supabase → Project Settings → API → JWT Settings → copy the exact secret.

**Password reset link gives `ERR_CONNECTION_REFUSED`**
The Supabase Site URL is wrong. Check Option A → Step 5.

**`P1001: Can't reach database server`**
`DATABASE_URL` is incorrect or you're offline (Supabase is a hosted database).

**Redis connection error**
```bash
docker start reportloop-redis
# or if it doesn't exist yet:
docker run -d --name reportloop-redis -p 6379:6379 redis:alpine
```

**Docker container can't reach Redis**
Make sure you're including `--add-host=host.docker.internal:host-gateway -e REDIS_URL=redis://host.docker.internal:6379` in your `docker run` command.
