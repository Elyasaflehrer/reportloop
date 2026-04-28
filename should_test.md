# Things to Test

## Rate Limiting

- [ ] Hit `POST /schedules/:id/fire` more than 5 times in a minute — should get `429 RATE_LIMITED` on the 6th request
- [ ] Hit any other endpoint more than 100 times in a minute — should get `429 RATE_LIMITED`
- [ ] Set `RATE_LIMIT_FIRE_MAX=2` in `.env`, restart, confirm the limit changes to 2
