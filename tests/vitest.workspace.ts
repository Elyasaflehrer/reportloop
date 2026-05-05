// Vitest workspace defines two test "projects":
//   - ci  : Tier 1, runs on every commit, backend uses mocked Twilio
//   - e2e : Tier 2, pre-prod release gate, backend uses real Twilio
//
// Both run against a separately-running backend dev server. They differ only
// in which test files vitest picks up and how long each test is allowed to take.

import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'ci',
      include: ['src/ci/**/*.test.ts'],
      environment: 'node',
      // Each test does real HTTP + DB cleanup; 10s is generous for CI scenarios.
      testTimeout: 10_000,
    },
  },
  {
    test: {
      name: 'e2e',
      include: ['src/e2e/**/*.test.ts'],
      environment: 'node',
      // E2E waits for real Twilio delivery (1–30s) + AI processing (2–5s).
      testTimeout: 120_000,
    },
  },
])
