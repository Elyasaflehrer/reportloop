import Redis from 'ioredis'
import RedisMock from 'ioredis-mock'
import { config } from './config.js'

const useMock = !config.redis.url || config.redis.url === 'mock'

if (useMock) {
  console.warn(
    '[redis] using in-memory RedisMock — REDIS_URL is "mock" or unset. ' +
    'BullMQ workers will not function correctly.'
  )
} else {
  try {
    const u = new URL(config.redis.url!)
    console.info(`[redis] using ${u.protocol}//${u.hostname}:${u.port || '(default)'}`)
  } catch {
    console.info('[redis] using configured REDIS_URL (could not parse for display)')
  }
}

export const redis = useMock
  ? new RedisMock()
  : new Redis(config.redis.url!, { maxRetriesPerRequest: null, lazyConnect: true })
