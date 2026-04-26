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

Currently the frontend is a single `AI_Reporter.html` file opened directly in the browser.

Plan for v2:
- Move to a Vite + React project (or Next.js).
- Serve the frontend from the backend or a CDN (Vercel / Netlify).
- Replace hardcoded `SUPABASE_URL` / `SUPABASE_ANON_KEY` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` build-time env vars.
- Wire all API calls to the real backend (Phase 5).
