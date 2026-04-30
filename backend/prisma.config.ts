import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrate: {
    async adapter(env) {
      const { Pool } = await import('pg')
      const { PrismaPg } = await import('@prisma/adapter-pg')
      // Use direct URL for migrations to bypass the connection pooler
      const pool = new Pool({ connectionString: env.DATABASE_URL_DIRECT ?? env.DATABASE_URL })
      return new PrismaPg(pool)
    },
  },
})
