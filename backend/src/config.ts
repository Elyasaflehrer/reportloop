import { z } from 'zod'

const schema = z.object({
  node_env:  z.enum(['development', 'production', 'test']).default('development'),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  app: z.object({
    port:           z.coerce.number().default(3000),
    baseUrl:        z.string().url(),
    frontendOrigin: z.string().url(),
  }),

  database: z.object({
    url:       z.string().min(1),
    directUrl: z.string().min(1),
  }),

  supabase: z.object({
    url:            z.string().url(),
    serviceRoleKey: z.string().min(1),
    jwtSecret:      z.string().min(1),
  }),

  redis: z.object({
    url: z.string().min(1),
  }),

  // Optional — app starts without it, SMS features disabled until set.
  // See .env.example and docs/adding-sms-provider.md.
  smsProvider: z.enum(['twilio']).default('twilio'),
  twilio: z.object({
    accountSid: z.string().min(1),
    authToken:  z.string().min(1),
    fromNumber: z.string().min(1),
  }).nullable().default(null),

  // Optional — required only when AI features are used (Phase 3).
  // Supports multiple providers: set AI_PROVIDER to 'anthropic' (default) or 'openai'.
  ai: z.object({
    provider: z.enum(['anthropic', 'openai']).default('anthropic'),
    apiKey:   z.string().min(1),
  }).nullable().default(null),

  sms: z.object({
    maxLength: z.coerce.number().default(459),
  }),

  broadcast: z.object({
    concurrency:  z.coerce.number().default(3),
    retryCount:   z.coerce.number().default(3),
    retryDelayMs: z.coerce.number().default(5000),
  }),

  conversation: z.object({
    reminderIntervalMinutes: z.coerce.number().default(60),
    reminderCount:           z.coerce.number().default(2),
    stuckTimeoutMinutes:     z.coerce.number().default(30),
    retentionDays:           z.coerce.number().default(0),
  }),

  rateLimits: z.object({
    globalMax: z.coerce.number().default(100),
    fireMax:   z.coerce.number().default(5),
  }),
})

const twilioConfigured =
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_FROM_NUMBER

export const config = schema.parse({
  node_env:  process.env.NODE_ENV,
  log_level: process.env.LOG_LEVEL,

  app: {
    port:           process.env.PORT,
    baseUrl:        process.env.APP_BASE_URL,
    frontendOrigin: process.env.FRONTEND_ORIGIN,
  },

  database: {
    url:       process.env.DATABASE_URL,
    directUrl: process.env.DATABASE_URL_DIRECT,
  },

  supabase: {
    url:            process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret:      process.env.SUPABASE_JWT_SECRET,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  smsProvider: process.env.SMS_PROVIDER,
  twilio: twilioConfigured ? {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken:  process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  } : null,

  ai: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
    ? {
        provider: (process.env.AI_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai',
        apiKey:   (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)!,
      }
    : null,

  sms: {
    maxLength: process.env.SMS_MAX_LENGTH,
  },

  broadcast: {
    concurrency:  process.env.BROADCAST_CONCURRENCY,
    retryCount:   process.env.BROADCAST_RETRY_COUNT,
    retryDelayMs: process.env.BROADCAST_RETRY_DELAY_MS,
  },

  conversation: {
    reminderIntervalMinutes: process.env.CONVERSATION_REMINDER_INTERVAL_MINUTES,
    reminderCount:           process.env.CONVERSATION_REMINDER_COUNT,
    stuckTimeoutMinutes:     process.env.CONVERSATION_STUCK_TIMEOUT_MINUTES,
    retentionDays:           process.env.CONVERSATION_RETENTION_DAYS,
  },

  rateLimits: {
    globalMax: process.env.RATE_LIMIT_GLOBAL_MAX,
    fireMax:   process.env.RATE_LIMIT_FIRE_MAX,
  },
})

if (!config.twilio) {
  console.warn(
    '[config] Twilio not configured — SMS features disabled. ' +
    'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to enable.'
  )
}
