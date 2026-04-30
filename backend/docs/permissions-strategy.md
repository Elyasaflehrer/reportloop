# Permissions Strategy

## Roles

| Role | Description |
|---|---|
| `admin` | Full access to all data, users, groups, schedules, and broadcasts |
| `manager` | Access scoped to their own groups, schedules, and broadcasts |
| `viewer` | Read-only access — see conversations for managers they are connected to via groups |
| `participant` | Access to their own conversations only |

---

## Viewer Access Levels

A viewer's access to a specific manager's data is determined per-request by three rules, evaluated in order. The first rule that matches wins.

| Rule | Condition | Access level | What the viewer sees |
|---|---|---|---|
| **Active group member** | Viewer is currently in a group linked to the manager, AND the manager's role is still `manager` | `full` | All conversations from all participants under that manager |
| **Historical participant** | Viewer has their own conversation records from that manager's broadcasts (e.g. they were removed from the group, or the manager was downgraded) | `own` | Only their own conversations |
| **No connection** | Neither of the above | `none` | 403 Forbidden |

---

## Viewer Dropdown — Manager List

When a viewer logs in, `/auth/me` builds their manager list from two sources merged together:

| Source | Access assigned |
|---|---|
| Groups the viewer currently belongs to (manager role = `manager`) | `full` |
| Managers from whom the viewer has historical participant conversations | `own` |

If a manager appears in both sources, `full` wins.

The dropdown in the UI displays:
- `Manager Name · All conversations` — for `full` access
- `Manager Name · Your history only` — for `own` access

---

## Role-Change Scenarios

| Scenario | Result |
|---|---|
| Admin removes viewer from a group; viewer has past conversations | Viewer loses `full`, keeps `own` — sees only their own conversations |
| Admin removes viewer from a group; viewer has no past conversations | Manager disappears from dropdown entirely |
| Manager is downgraded to viewer; users in their groups still have conversations | Users lose `full` access — fall back to `own` (see only their own conversations) |
| Manager is downgraded to viewer; they were also a participant | Former manager sees only their own participant conversations (`own`) |
| Manager is downgraded to viewer; they were never a participant | Former manager sees nothing — no entry in dropdown |

---

## Broadcast Scoping Per Role

| Role | `GET /broadcasts` | `GET /broadcasts/:id/conversations` | `GET /conversations/:id` |
|---|---|---|---|
| `admin` | All broadcasts | All conversations | Any conversation |
| `manager` | Broadcasts from their own schedules only | All conversations in that broadcast | Any conversation in their broadcasts |
| `viewer` (`full`) | All broadcasts for the selected manager | All conversations in that broadcast | Any conversation in that broadcast |
| `viewer` (`own`) | Only broadcasts where the viewer has a conversation | Only the viewer's own conversation row | Only if the conversation belongs to the viewer |
| `participant` | Only broadcasts where they have a conversation | Only their own conversation row | Only their own conversation |

---

## Key Implementation Files

| File | What it does |
|---|---|
| `backend/src/routes/broadcasts.ts` | `viewerAccessLevel()` — determines `full / own / none` per request |
| `backend/src/routes/auth.ts` | `/auth/me` — builds `viewableManagers` list with `access` field |
| `frontend/src/context/SessionContext.tsx` | Maps `viewableManagers` into session, sets `activeManagerId` |
| `frontend/src/components/layout/ViewerManagerBar.tsx` | Renders manager dropdown with access level labels |
| `frontend/src/components/history/History.tsx` | Skips fetch when `managerFilterId` is null/undefined/NaN |
