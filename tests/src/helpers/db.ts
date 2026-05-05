// Direct DB access for tests. Used ONLY for:
//   1. truncateAll() — wipe state between tests
//   2. Asserting on rows that don't have a corresponding API endpoint
//      (e.g., InboundAuditLog, raw row counts after operations)
//   3. Seeding rare cases where API setup is awkward (e.g., a soft-deleted
//      user's `deletedAt` field)
//
// All BEHAVIOR under test must still go through the HTTP API — never use
// this client to bypass auth, RBAC, or any other backend concern.

import { PrismaClient } from '@prisma/client'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
if (!TEST_DATABASE_URL) {
  throw new Error(
    '[tests/db] TEST_DATABASE_URL is not set. ' +
    'Copy .env.example to .env and set the test DB connection string.',
  )
}

// Safety: refuse to truncate anything if the DB URL doesn't look like a
// dedicated test DB. Prevents accidentally nuking dev data.
const looksLikeTestDb = /test|local|tmp/i.test(TEST_DATABASE_URL)
if (!looksLikeTestDb) {
  console.warn(
    '[tests/db] TEST_DATABASE_URL does not contain "test", "local", or "tmp". ' +
    'truncateAll() will refuse to run. Override at your own risk.',
  )
}

export const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
})

// Tables truncated in dependency order (CASCADE handles the rest, but listing
// them makes the cleanup explicit and grep-able).
const TABLES_TO_TRUNCATE = [
  'messages',
  'answers',
  'inbound_audit_logs',
  'conversations',
  'broadcasts',
  'schedule_recipients',
  'schedule_questions',
  'schedules',
  'manager_groups',
  'group_members',
  'groups',
  'questions',
  'users',
] as const

export async function truncateAll(): Promise<void> {
  if (!looksLikeTestDb) {
    throw new Error(
      '[tests/db] Refusing to truncate — TEST_DATABASE_URL does not look like a test DB. ' +
      'Database name should contain "test", "local", or "tmp".',
    )
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')}
    RESTART IDENTITY CASCADE
  `)
}
