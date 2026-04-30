import Redis from 'ioredis'
import RedisMock from 'ioredis-mock'
import { config } from './config.js'

const useMock = !config.redis.url || config.redis.url === 'mock'

export const redis = useMock
  ? new RedisMock()
  : new Redis(config.redis.url!, { maxRetriesPerRequest: null, lazyConnect: true })
