# Version 1.1 — Manager Context for Viewer & Participant Screens

## Background

A user (u1) can belong to a group (g1), and that group can be attached to multiple managers (m1, m2).
Both managers can send broadcasts to u1, so u1 accumulates conversations from m1's schedules and from m2's schedules.
The UI currently shows no manager context at all — everything is flat.

---

## The Problem Is Different Per Role

### Participant
The participant only sees their **own** conversations. The issue is not volume — it's organization.
When m1 and m2 both send to u1, the conversation list mixes threads from two different managers with no separation.
A switcher would actually hide the participant's own data, which is wrong.
**Solution: group conversations by manager, not filter by manager.**

### Viewer
The viewer sees conversations of **all users** connected to their managers.
This can be a large dataset spanning many participants across multiple managers.
Showing everything at once is overwhelming.
**Solution: a manager switcher that scopes the view to one manager at a time.**

---

## Task 1 — Viewer Screen: Manager Switcher

Broken into the following sub-tasks:

---

### 1a — Backend: `/auth/me` returns correct managers for viewer

**What it does:** when a viewer logs in, the server must tell the frontend which managers they are connected to, including each manager's name.

**How it works:** the query walks group membership → manager links → user names. For example, if viewer v1 is in group g1 and g1 is attached to m1 and m2, the response includes both.

**Why it matters:** without this, the frontend has no list of managers to show in the dropdown and no names to display.

- [x] Query returns `viewableManagers: [{id, name}]` and `viewableManagerIds: [id]` for viewer role

---

### 1b — Frontend: Session stores `viewableManagers` and sets `activeManagerId`

**What it does:** when `/auth/me` responds, `SessionContext` maps `viewableManagers` into the session object and sets `activeManagerId` to the first manager by default.

**Why it matters:** every component that needs to know "which manager is selected" reads from the session. If the session doesn't store this, the dropdown and the data fetch have no shared state.

- [x] `viewableManagers` mapped in `SessionContext`
- [x] `activeManagerId` defaulted to first manager on login

---

### 1c — Frontend: `ViewerManagerBar` renders correctly for all cases

**What it does:** the bar appears at the top of the screen for all viewer users. It shows a dropdown when there are multiple managers, and a plain label when there is only one (no real switching needed, but the manager context is still shown).

**Why it matters:** the viewer always needs to know whose data they are looking at. Even with one manager, showing the name gives important context.

- [x] Bar hides when `viewableManagers` is empty (viewer has no group assignments)
- [x] Bar shows when `viewableManagers` has one or more managers
- [x] When one manager: show dropdown with one option
- [x] When two or more managers: show a working dropdown switcher
- [x] When `viewableManagers` is empty: `App.tsx` renders "You have no managers assigned. Contact your admin." in the main content area instead of `History` — `History` is not rendered at all in this case

---

### 1d — Backend: `GET /broadcasts` filters by `managerId` for viewer

**What it does:** the viewer's selected manager ID is passed as `?managerId=X` in the API call. The backend checks that the viewer actually has access to that manager (security), then returns only broadcasts belonging to that manager's schedules.

**Why it matters:** without this filter, the viewer would see broadcasts from all managers at once — or get a 403.

- [x] `managerId` query param accepted and validated
- [x] Access check: viewer must share a group with the given manager
- [x] Broadcasts filtered to `schedule.managerId = managerId`

---

### 1e — Frontend: `History` re-fetches when selected manager changes

**What it does:** when the viewer picks a different manager from the dropdown, `History` detects the `managerFilterId` prop changed and fires a new API request with the new `managerId`.

**Why it matters:** the conversation list must update immediately on switch. If the component does not react to the prop change, the viewer sees stale data from the previous manager.

- [x] `managerFilterId` is in the `useCallback` dependency array
- [x] Fetch is skipped when `managerFilterId === null` (no manager selected yet)
- [ ] ~~Loading state while new data loads after switching~~ → deferred to v2

---

### 1f — Error Handling

**What it does:** if the broadcast fetch fails for any reason, show a friendly message. The user does not need to know why — just that something went wrong.

**Message:** "Failed to load data. Please contact support." (no contact details for now, just this text)

- [x] `History` shows this message when `GET /broadcasts` fails
- [x] Message replaces the list (no blank screen)

---

### 1g — Empty State & Per-Role Messages

**What it does:** `History` is shared across admin, manager, viewer, and participant. Each role needs a message that makes sense for them. The message is passed as a prop from the parent so `History` stays generic.

**Messages per role:**
- Viewer: "No broadcasts yet for this manager."
- Manager: "No broadcasts yet. Use Send now or wait for a scheduled broadcast."
- Admin: "No broadcasts yet. Trigger a report cycle via Send now or a scheduled broadcast."
- Participant: "No check-ins yet. Your reports will appear here after the first one has started."

- [ ] `History` accepts an `emptyMessage` prop (string) and renders it when the list is empty and no error occurred
- [ ] Each parent that renders `History` passes the correct message for its role

---

### 1h — Smoke Tests

- [ ] Viewer with one manager — bar shows, conversations load correctly
- [x] Viewer with two managers — dropdown appears, switching updates the conversation list
- [x] Viewer with no group assignments — bar does not appear, "You have no managers assigned. Contact your admin." shown
- [ ] Viewer selects m2 — only m2's broadcasts are shown
- [x] Viewer with a manager that has no broadcasts — "No broadcasts yet for this manager." appears
- [ ] Manager with no broadcasts — "No broadcasts yet. Use Send now or wait for a scheduled broadcast." appears
- [ ] Network/server error — "Failed to load data. Please contact support." appears

---

## Task 2 — Participant Screen: Group Conversations by Manager

The participant sees all their conversations, but organized under a manager header.
If u1 has conversations from m1 and m2, the screen shows two sections:

```
▼ m1 — Weekly send (Apr 28)
    conversation detail...

▼ m2 — Monthly review (Apr 1)
    conversation detail...
```

**What needs to change:**

### Backend
- `GET /auth/me` for participant role: run the same group → manager query already used for viewer.
  Return `viewableManagers: [{id, name}]` so the frontend knows which managers the participant belongs to.
- `GET /broadcasts` for participant: no change to filtering (participant still sees all their own conversations).
  The grouping is done on the frontend using the `scheduleId → managerId` relationship already present in the broadcast data.

### Frontend
- `ParticipantPortal.tsx`: instead of a flat `<History />`, fetch broadcasts and group them by manager before rendering.
  Each manager gets a collapsible section header showing the manager name.
  Inside each section, broadcasts are listed chronologically (same expand-to-conversations behavior as today).
- `SessionContext.tsx`: map `viewableManagers` from `/auth/me` scope for participant role (same as viewer).
  This gives the frontend the manager names to use as section headers.

### How grouping works
Each broadcast already carries `scheduleId`. Each schedule belongs to one manager via `managerId`.
The backend already returns the schedule label with each broadcast.
To group by manager, the frontend needs to know which `managerId` each broadcast belongs to — this requires either:
  - Including `managerId` in the broadcast response (backend change), or
  - Using the session's `viewableManagers` list and matching via the schedule's manager

**Preferred approach:** add `managerId` to the `GET /broadcasts` response payload so the frontend can group without extra round-trips.

---

## Task 3 — Smoke Tests

- [ ] Participant attached to one manager — conversations show under that manager's section
- [ ] Participant attached to two managers — conversations grouped under two separate manager sections
- [ ] Participant with conversations from both managers — each section shows only its manager's broadcasts
- [ ] Viewer with one manager — bar shows manager name (no switcher)
- [ ] Viewer with two managers — switcher appears, switching updates the conversation list
