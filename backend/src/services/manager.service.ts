import type { PrismaClient, Prisma } from '@prisma/client'
import type { ISmsProvider } from './sms/sms.provider.interface.js'
import { provisionForManager, type PhoneProvisionSettings } from './sms/phone-number.service.js'
import { ProvisionLimitError, ProvisionFailedError } from './sms/phone-number.errors.js'

// ─── ON MANAGER DEMOTED ──────────────────────────────────────────────────────

type ManagerDemotedDeps<S extends Prisma.UserSelect> = {
  prisma:  PrismaClient
  select:  S
}

export async function onManagerDemoted<S extends Prisma.UserSelect>(
  userId:     number,
  updateData: Prisma.UserUpdateInput,
  deps:       ManagerDemotedDeps<S>,
): Promise<Prisma.UserGetPayload<{ select: S }>> {

  // Layer 1 — atomic: role change + schedule deactivation commit together.
  // Errors bubble up — a partial demotion (role changed, schedules still active) would fire live broadcasts.
  const user = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where:  { id: userId },
      data:   updateData,
      select: deps.select,
    })
    await tx.schedule.updateMany({
      where: { managerId: userId, deletedAt: null },
      data:  { active: false, deletedAt: new Date() },
    })
    return updated
  })

  // Layer 2 — best-effort: questions + group links carry no broadcast risk.
  // Fire-and-forget — response does not wait for this.
  deps.prisma.$transaction([
    deps.prisma.question.updateMany({
      where: { managerId: userId, deletedAt: null },
      data:  { deletedAt: new Date() },
    }),
    deps.prisma.managerGroup.deleteMany({
      where: { managerId: userId },
    }),
  ]).catch(err => console.error('[manager] demotion layer-2 cleanup failed', { userId, err }))

  return user
}

// ─── ON MANAGER CREATED ──────────────────────────────────────────────────────

type ManagerCreatedDeps = {
  prisma:        PrismaClient
  smsProvider:   ISmsProvider | null
  phoneSettings: PhoneProvisionSettings
}

export async function onManagerCreated(
  userId: number,
  deps:   ManagerCreatedDeps,
): Promise<void> {
  if (!deps.smsProvider) {
    console.info(`[manager] SMS not configured — skipping phone provisioning for user ${userId}`)
    return
  }

  try {
    const phone = await provisionForManager(userId, {
      prisma:        deps.prisma,
      smsProvider:   deps.smsProvider,
      phoneSettings: deps.phoneSettings,
    })
    console.info(`[manager] provisioned ${phone} for user ${userId}`)
  } catch (err) {
    if (err instanceof ProvisionLimitError) {
      console.warn(`[manager] phone limit reached — user ${userId} created without a number`)
      return
    }
    if (err instanceof ProvisionFailedError) {
      console.warn(`[manager] provisioning failed — user ${userId} created without a number`, err)
      return
    }
    console.error(`[manager] unexpected error provisioning number for user ${userId}`, err)
  }
}
