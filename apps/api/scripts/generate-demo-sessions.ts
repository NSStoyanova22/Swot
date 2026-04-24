import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const USER_ID = 'swot-user'
const DEMO_TAG = '[SWOT_DEMO_WEEK]'

type PlannedSession = {
  day: Date
  hour: number
  minute: number
  durationMinutes: number
  breakMinutes: number
  note: string
}

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function startOfWeekMonday(date: Date) {
  const dayIndex = (date.getDay() + 6) % 7
  return addDays(startOfDay(date), -dayIndex)
}

function setTime(date: Date, hour: number, minute: number) {
  const value = new Date(date)
  value.setHours(hour, minute, 0, 0)
  return value
}

function pick<T>(items: T[], index: number): T {
  if (items.length === 0) {
    throw new Error("Cannot pick from an empty array")
  }

  const normalizedIndex = ((index % items.length) + items.length) % items.length
  const picked = items[normalizedIndex]
  if (picked === undefined) {
    throw new Error("Unexpected empty array access in pick()")
  }

  return picked
}

function buildPlanForDay(day: Date, dayOffset: number, isToday: boolean): PlannedSession[] {
  const slots = [
    { hour: 8, minute: 20 },
    { hour: 10, minute: 35 },
    { hour: 14, minute: 20 },
    { hour: 17, minute: 45 },
    { hour: 20, minute: 10 },
  ]

  const durations = [42, 50, 58, 65, 72, 80, 47, 55, 63, 70, 88]
  const breaks = [0, 5, 5, 10, 0, 5, 10]
  const notes = [
    'Focused review and active recall drills.',
    'Practice set with error correction on weak topics.',
    'Timed prep block with short recap at the end.',
    'Revision block: summarize key ideas and examples.',
    'Deep focus session with spaced repetition pass.',
    'Exercise-heavy block with quick post-session notes.',
    'Mixed practice and concept reinforcement.',
  ]

  const defaultCount = dayOffset <= 2 ? 3 : 2
  const sessionCount = isToday ? defaultCount + 1 : defaultCount

  return Array.from({ length: Math.min(sessionCount, slots.length) }, (_, sessionIndex) => {
    const durationMinutes = pick(durations, dayOffset * 3 + sessionIndex)
    const breakMinutes = pick(breaks, dayOffset + sessionIndex)
    const note = `${pick(notes, dayOffset * 2 + sessionIndex)} ${DEMO_TAG}`
    const slot = slots[sessionIndex]!

    return {
      day,
      hour: slot.hour,
      minute: slot.minute,
      durationMinutes,
      breakMinutes,
      note,
    }
  })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const user = await prisma.user.findUnique({ where: { id: USER_ID } })
  if (!user) {
    throw new Error(`User ${USER_ID} not found. Run seed first (pnpm --filter api exec prisma db seed).`)
  }

  const courses = await prisma.course.findMany({
    where: { userId: USER_ID },
    orderBy: { name: 'asc' },
    include: {
      activities: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (courses.length === 0) {
    throw new Error('No courses found. Create courses first, then run this demo generator.')
  }

  const today = startOfDay(new Date())
  const weekStart = startOfWeekMonday(today)
  const tomorrow = addDays(today, 1)

  const weekDays: Date[] = []
  for (let cursor = weekStart; cursor.getTime() <= today.getTime(); cursor = addDays(cursor, 1)) {
    weekDays.push(new Date(cursor))
  }

  const plan = weekDays.flatMap((day, dayOffset) => buildPlanForDay(day, dayOffset, day.getTime() === today.getTime()))

  const rows = plan.map((item, index) => {
    const course = courses[index % courses.length]!
    const activity = course.activities.length > 0 ? course.activities[index % course.activities.length] : null
    const startTime = setTime(item.day, item.hour, item.minute)
    const endTime = addDays(startTime, 0)
    endTime.setMinutes(endTime.getMinutes() + item.durationMinutes + item.breakMinutes)

    return {
      userId: USER_ID,
      courseId: course.id,
      activityId: activity?.id ?? null,
      startTime,
      endTime,
      breakMinutes: item.breakMinutes,
      durationMinutes: item.durationMinutes,
      note: item.note,
    }
  })

  if (dryRun) {
    console.log('[dry-run] Planned demo sessions:')
    rows.forEach((row) => {
      console.log(
        `${row.startTime.toLocaleString()} | ${row.durationMinutes}m (+${row.breakMinutes}m break) | course=${row.courseId}`,
      )
    })
    console.log(`[dry-run] Total sessions: ${rows.length}`)
    return
  }

  const deleted = await prisma.studySession.deleteMany({
    where: {
      userId: USER_ID,
      note: { contains: DEMO_TAG },
      startTime: {
        gte: weekStart,
        lt: tomorrow,
      },
    },
  })

  await prisma.studySession.createMany({ data: rows })

  console.log(`Demo sessions generated: ${rows.length}`)
  console.log(`Replaced previous demo rows: ${deleted.count}`)
  console.log(`Window: ${weekStart.toDateString()} -> ${today.toDateString()}`)
  console.log(`Courses used: ${courses.length} existing course(s), no new courses created.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
