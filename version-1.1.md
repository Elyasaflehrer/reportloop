# Version 1.1 — Role System Overhaul

## Task 1 — Add Participant to Edit User Role Dropdown

In `AdminUsersTab.tsx` the edit form role dropdown is missing the `participant` option. The add form has it but the edit form stops at `viewer`.

- [x] Add `<option value="participant">participant</option>` to the edit form role dropdown in `AdminUsersTab.tsx`

---

## Task 2 — Unblock Participant Data Access

Participant can log in but gets 403 on every API call because all endpoints have `requireRole('admin', 'manager')`. Participant scope rule: **only their own conversations** (`WHERE userId = currentUser.id`).

Two files need to change:

**Problem 1 — AppDataContext** fetches `/groups`, `/participants`, `/questions`, `/schedules` for every role on startup. All four require admin/manager → participant gets 403 before any screen loads. Fix: skip those fetches when role is `participant`.

**Problem 2 — backend `broadcasts.ts`** has `requireRole('admin', 'manager')` on all three endpoints. Fix: add `'participant'` and filter by `userId = currentUser.id` for participant.

### Steps

- [x] `AppDataContext.tsx` — skip `/groups`, `/participants`, `/questions`, `/schedules` fetches when `role === 'participant'` (keep them for admin/manager/viewer)
- [x] `GET /broadcasts` — add `participant` to `requireRole`; for participant add `where conversations: { some: { userId: req.user.id } }` (or scope schedule → broadcast → conversation to userId)
- [x] `GET /broadcasts/:id/conversations` — add `participant` to `requireRole`; add `where userId: req.user.id` to the conversation query
- [x] `GET /conversations/:id` — add `participant` to `requireRole`; verify the existing access check catches wrong userId (add `userId: req.user.id` to the findFirst where)
- [x] Smoke test: participant logs in → sees only their broadcasts and conversations, no 403s

---

## Task 3 — Wire Viewer Screens to Real API

`ViewerManagerBar.tsx` and the viewer correspondence screens already exist but show no real data.

### Steps

- [ ] Identify all API calls made by viewer screens and confirm they match the endpoints updated in task 2
- [ ] Wire manager switcher — fetch the list of managers the viewer is connected to (derived from their group memberships)
- [ ] Pass selected manager as a filter param on all viewer data requests
- [ ] Test: viewer sees only data belonging to the selected manager's groups
- [ ] Test: switching manager updates all data on screen

---

## Task 4 — Wire Participant Screens to Real API

`ParticipantPortal.tsx` already exists but shows no real data.

### Steps

- [ ] Identify all API calls made by `ParticipantPortal.tsx` and confirm they match the endpoints updated in task 2
- [ ] Wire conversation list — fetch only conversations where `userId = currentUser.id`
- [ ] Wire conversation detail — messages and extracted answers for the selected conversation
- [ ] Test: participant sees only their own conversations
- [ ] Test: participant cannot access another user's data
