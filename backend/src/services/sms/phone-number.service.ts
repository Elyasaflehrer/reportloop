import type { PrismaClient } from '@prisma/client'
import type { ISmsProvider } from './sms.provider.interface.js'
import { ProvisionLimitError, ProvisionFailedError } from './phone-number.errors.js'

export type PhoneProvisionSettings = {
  maxNumbers:    number
  numberCountry: string
  numberType:    string
  webhookBaseUrl: string
}

type ProvisionDeps = {
  prisma:        PrismaClient
  smsProvider:   ISmsProvider
  phoneSettings: PhoneProvisionSettings
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function provisionForManager(
  userId: number,
  deps:   ProvisionDeps,
): Promise<string> {
  return (
    await reuseOwnNumber(userId, deps)    ??
    await recycleIdleNumber(userId, deps) ??
    await purchaseNewNumber(userId, deps)
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function reuseOwnNumber(
  userId: number,
  { prisma }: ProvisionDeps,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { assignedPhone: true },
  })
  return user?.assignedPhone ?? null
}

async function recycleIdleNumber(
  userId: number,
  { prisma }: ProvisionDeps,
): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const source = await tx.user.findFirst({
        where:  { assignedPhone: { not: null }, role: { not: 'manager' }, id: { not: userId } },
        select: { id: true, assignedPhone: true, assignedPhoneSid: true },
      })
      if (!source) return null

      await tx.user.update({
        where: { id: userId },
        data:  { assignedPhone: source.assignedPhone, assignedPhoneSid: source.assignedPhoneSid },
      })
      await tx.user.update({
        where: { id: source.id },
        data:  { assignedPhone: null, assignedPhoneSid: null },
      })
      return source.assignedPhone!
    })
  } catch (err: any) {
    // P2002 = unique constraint race between concurrent manager creations — fall through to purchase
    if (err?.code !== 'P2002') throw err
    return null
  }
}

async function purchaseNewNumber(
  userId: number,
  { prisma, smsProvider, phoneSettings }: ProvisionDeps,
): Promise<string> {
  const count = await prisma.user.count({ where: { assignedPhone: { not: null } } })
  if (count >= phoneSettings.maxNumbers) throw new ProvisionLimitError()

  try {
    const webhookUrl = `${phoneSettings.webhookBaseUrl}/webhooks/twilio`
    const result = await smsProvider.provisionNumber({
      webhookUrl,
      country:    phoneSettings.numberCountry,
      numberType: phoneSettings.numberType,
    })
    await prisma.user.update({
      where: { id: userId },
      data:  { assignedPhone: result.assignedPhone, assignedPhoneSid: result.assignedPhoneSid },
    })
    return result.assignedPhone
  } catch (err) {
    throw new ProvisionFailedError(err)
  }
}
