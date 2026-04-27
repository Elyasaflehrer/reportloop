import { PrismaClient } from '@prisma/client'
import { config } from './config.js'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.log_level === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (config.node_env !== 'production') globalForPrisma.prisma = prisma
