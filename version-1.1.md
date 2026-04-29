# Version 1.1 — Role System Overhaul

## Task 1 — Add Participant to Edit User Role Dropdown

In `AdminUsersTab.tsx` the edit form role dropdown is missing the `participant` option. The add form has it but the edit form stops at `viewer`.

- [x] Add `<option value="participant">participant</option>` to the edit form role dropdown in `AdminUsersTab.tsx`

---

## Task 2 — Scope Logic on All Data Endpoints

Right now viewer and participant are blocked from all data endpoints (`requireRole('admin', 'manager')`). This task opens the read endpoints to these roles and applies the correct data filter per role.

**Viewer scope:**
```
1. GroupMember WHERE userId = viewerId        → groupIds
2. ManagerGroup WHERE groupId IN groupIds     → managerIds
3. ManagerGroup WHERE managerId IN managerIds → allGroupIds (ALL groups of those managers)
4. GroupMember WHERE groupId IN allGroupIds   → allUserIds
5. filter data WHERE userId IN allUserIds
```
If viewer has no group memberships → fall back to own data only.
Viewer can switch between managers — scope to selected manager at steps 2–5.

**Participant scope:**
```
filter data WHERE userId = currentUser.id
```
If participant has no group memberships → same, own data only.

### Steps

- [ ] `GET /broadcasts` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /broadcasts/:id/conversations` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /conversations/:id/messages` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /conversations/:id/analysis` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /schedules` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /groups` — add `viewer` and `participant` to `requireRole`, apply scope filter
- [ ] `GET /participants` — add `viewer` and `participant` to `requireRole`, apply scope filter

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
