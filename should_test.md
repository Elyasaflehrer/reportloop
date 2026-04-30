# Things to Test

## Viewer Scope

- [ ] Attach a viewer to two managers — verify the manager switcher appears and switching updates the conversations shown
- [ ] Attach two users to the same manager in the same group — verify the viewer sees both users' conversations
- [ ] Attach two users to two different groups and assign both groups to one manager — verify the viewer sees conversations from both groups

---

## Rate Limiting

- [ ] Hit `POST /schedules/:id/fire` more than 5 times in a minute — should get `429 RATE_LIMITED` on the 6th request
- [ ] Hit any other endpoint more than 100 times in a minute — should get `429 RATE_LIMITED`
- [ ] Set `RATE_LIMIT_FIRE_MAX=2` in `.env`, restart, confirm the limit changes to 2
