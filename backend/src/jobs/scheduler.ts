import cron from 'node-cron'
import { DateTime } from 'luxon'
import { prisma } from '../db.js'
import { broadcastQueue } from './queue.js'

export function startScheduler() {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await checkSchedules()
    } catch (err) {
      console.error('[scheduler] error during schedule check:', err)
    }
  })

  console.info('[scheduler] started — checking schedules every minute')
  return task
}

async function checkSchedules() {
  const schedules = await prisma.schedule.findMany({
    where: { active: true, deletedAt: null },
    select: {
      id:         true,
      dayOfWeek:  true,
      timeOfDay:  true,
      timezone:   true,
    },
  })

  for (const schedule of schedules) {
    const now = DateTime.now().setZone(schedule.timezone)

    // Check day of week
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    if (days[now.weekday % 7] !== schedule.dayOfWeek) continue

    // Check time window — fire if we're in the HH:MM minute
    const [hh, mm]   = schedule.timeOfDay.split(':').map(Number)
    const fireMinute = DateTime.fromObject({ hour: hh, minute: mm }, { zone: schedule.timezone })
      .set({ year: now.year, month: now.month, day: now.day })

    const diffMinutes = Math.abs(now.diff(fireMinute, 'minutes').minutes)
    if (diffMinutes >= 1) continue

    // Secondary dedup — skip if a broadcast already exists for today
    const fireDate = now.toISODate()!
    const existing = await prisma.broadcast.findUnique({
      where: { scheduleId_fireDate: { scheduleId: schedule.id, fireDate } },
    })
    if (existing) continue

    // Enqueue — job ID is the dedup key (BullMQ skips duplicates with same ID)
    const jobId = `broadcast:${schedule.id}:${fireDate}`
    await broadcastQueue.add(
      'run',
      { scheduleId: schedule.id },
      { jobId },
    )

    console.info(`[scheduler] enqueued broadcast for schedule ${schedule.id} (${fireDate})`)
  }
}
