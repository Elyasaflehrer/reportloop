import { type FastifyRequest, type FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { type UserRole } from '@prisma/client'
import { config } from '../config.js'
import { prisma } from '../db.js'

// ─── REQUEST AUGMENTATION ────────────────────────────────────────────────────

type AuthUser = {
  id:         number
  supabaseId: string
  name:       string
  email:      string | null
  role:       UserRole
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser
  }
}

// ─── AUTHENTICATE ─────────────────────────────────────────────────────────────

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } })
  }

  const token = header.slice(7)

  let payload: jwt.JwtPayload

  try {
    payload = jwt.verify(token, config.supabase.jwtSecret) as jwt.JwtPayload
  } catch {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }

  const supabaseId = payload.sub
  if (!supabaseId) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token payload' } })
  }

  const user = await prisma.user.findFirst({
    where: {
      supabaseId,
      active:    true,
      deletedAt: null,
    },
    select: { id: true, supabaseId: true, name: true, email: true, role: true },
  })

  if (!user) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'User not found or inactive' } })
  }

  req.user = user as AuthUser
}

// ─── REQUIRE ROLE ─────────────────────────────────────────────────────────────

export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) {
      return reply.status(403).send({
        error: {
          code:    'FORBIDDEN',
          message: `This action requires one of the following roles: ${roles.join(', ')}`,
        },
      })
    }
  }
}
