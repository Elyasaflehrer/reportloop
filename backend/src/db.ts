import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from './config.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: config.log_level === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (config.node_env !== 'production') globalForPrisma.prisma = prisma
