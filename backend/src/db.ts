import { PrismaClient } from '@prisma/client'
import { config } from './config.js'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.node_env === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (config.node_env !== 'production') globalForPrisma.prisma = prisma
