// Loads .env.test into process.env BEFORE any test file is imported.
// Wired into vitest.workspace.ts via setupFiles.
import dotenv from 'dotenv'
dotenv.config({ path: '.env.test' })