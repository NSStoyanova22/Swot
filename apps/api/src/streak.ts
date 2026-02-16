import { prisma } from './db.js'

type StreakDailyRow = {
  study_date: Date
  actual_minutes: number
  target_minutes: number
  met_target: number
  medal: string
}

type StreakStateRow = {
  current_streak: number
  longest_streak: number
  missed_days: number
  cutoff_time: string
  updated_at: Date
}

const MEDAL_THRESHOLDS = {
  bronze: 60,
  silver: 120,
  gold: 180,
} as const

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

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function parseCutoffMinutes(cutoffTime: string) {
  const [hoursText, minutesText] = cutoffTime.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 300
  return Math.max(0, Math.min(23 * 60 + 59, hours * 60 + minutes))
}

function toStudyDayKey(date: Date, cutoffMinutes: number) {
  const shifted = new Date(date.getTime() - cutoffMinutes * 60_000)
  const day = startOfDay(shifted)
  return toDateKey(day)
}

function weekdayMonToSun(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay()
}

function calculateMedal(minutes: number) {
  if (minutes >= MEDAL_THRESHOLDS.gold) return 'gold'
  if (minutes >= MEDAL_THRESHOLDS.silver) return 'silver'
  if (minutes >= MEDAL_THRESHOLDS.bronze) return 'bronze'
  return 'none'
}

export async function ensureStreakTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS streak_state (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      current_streak INT NOT NULL DEFAULT 0,
      longest_streak INT NOT NULL DEFAULT 0,
      missed_days INT NOT NULL DEFAULT 0,
      cutoff_time VARCHAR(5) NOT NULL DEFAULT '05:00',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS streak_daily_stats (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      study_date DATE NOT NULL,
      actual_minutes INT NOT NULL,
      target_minutes INT NOT NULL,
      met_target TINYINT(1) NOT NULL,
      medal VARCHAR(16) NOT NULL,
      UNIQUE KEY uniq_user_study_date (user_id, study_date),
      INDEX idx_streak_daily_user_date (user_id, study_date)
    )
  `)
}

export async function recomputeAndStoreStreak(userId: string) {
  const [settings, targets, sessions] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    prisma.dailyTarget.findMany({ where: { userId } }),
    prisma.studySession.findMany({
      where: { userId },
      orderBy: { startTime: 'asc' },
    }),
  ])

  const cutoffTime = settings?.cutoffTime ?? '05:00'
  const cutoffMinutes = parseCutoffMinutes(cutoffTime)

  const targetByWeekday = new Map<number, number>()
  targets.forEach((target) => {
    targetByWeekday.set(target.weekday, target.targetMinutes)
  })

  const minutesByStudyDay = new Map<string, number>()
  sessions.forEach((session) => {
    const key = toStudyDayKey(new Date(session.startTime), cutoffMinutes)
    minutesByStudyDay.set(key, (minutesByStudyDay.get(key) ?? 0) + session.durationMinutes)
  })

  const todayStudyDayKey = toStudyDayKey(new Date(), cutoffMinutes)
  const todayStudyDay = fromDateKey(todayStudyDayKey)

  const firstStudyDay =
    sessions.length > 0
      ? fromDateKey(toStudyDayKey(new Date(sessions[0]!.startTime), cutoffMinutes))
      : todayStudyDay

  const rows: Array<{
    dateKey: string
    actualMinutes: number
    targetMinutes: number
    metTarget: boolean
    medal: string
  }> = []

  for (let cursor = firstStudyDay; cursor.getTime() <= todayStudyDay.getTime(); cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor)
    const actualMinutes = minutesByStudyDay.get(key) ?? 0
    const weekday = weekdayMonToSun(cursor)
    const targetMinutes = targetByWeekday.get(weekday) ?? 0
    const metTarget = targetMinutes > 0 ? actualMinutes >= targetMinutes : actualMinutes > 0

    rows.push({
      dateKey: key,
      actualMinutes,
      targetMinutes,
      metTarget,
      medal: calculateMedal(actualMinutes),
    })
  }

  let currentStreak = 0
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]?.metTarget) {
      currentStreak += 1
    } else {
      break
    }
  }

  let longestStreak = 0
  let running = 0
  let missedDays = 0

  rows.forEach((row) => {
    if (row.targetMinutes > 0 && !row.metTarget) {
      missedDays += 1
    }

    if (row.metTarget) {
      running += 1
      if (running > longestStreak) longestStreak = running
    } else {
      running = 0
    }
  })

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM streak_daily_stats WHERE user_id = ${userId}`

    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO streak_daily_stats (user_id, study_date, actual_minutes, target_minutes, met_target, medal)
        VALUES (${userId}, ${row.dateKey}, ${Math.round(row.actualMinutes)}, ${Math.round(row.targetMinutes)}, ${row.metTarget ? 1 : 0}, ${row.medal})
      `
    }

    await tx.$executeRaw`
      INSERT INTO streak_state (user_id, current_streak, longest_streak, missed_days, cutoff_time)
      VALUES (${userId}, ${currentStreak}, ${longestStreak}, ${missedDays}, ${cutoffTime})
      ON DUPLICATE KEY UPDATE
        current_streak = VALUES(current_streak),
        longest_streak = VALUES(longest_streak),
        missed_days = VALUES(missed_days),
        cutoff_time = VALUES(cutoff_time),
        updated_at = CURRENT_TIMESTAMP
    `
  })
}

export async function getStreakOverview(userId: string, days = 140) {
  const stateRows = await prisma.$queryRaw<StreakStateRow[]>`
    SELECT current_streak, longest_streak, missed_days, cutoff_time, updated_at
    FROM streak_state
    WHERE user_id = ${userId}
    LIMIT 1
  `

  if (stateRows.length === 0) {
    await recomputeAndStoreStreak(userId)
  }

  const effectiveStateRows =
    stateRows.length > 0
      ? stateRows
      : await prisma.$queryRaw<StreakStateRow[]>`
          SELECT current_streak, longest_streak, missed_days, cutoff_time, updated_at
          FROM streak_state
          WHERE user_id = ${userId}
          LIMIT 1
        `

  const state = effectiveStateRows[0] ?? {
    current_streak: 0,
    longest_streak: 0,
    missed_days: 0,
    cutoff_time: '05:00',
    updated_at: new Date(),
  }

  const dailyRows = await prisma.$queryRaw<StreakDailyRow[]>`
    SELECT study_date, actual_minutes, target_minutes, met_target, medal
    FROM streak_daily_stats
    WHERE user_id = ${userId}
    ORDER BY study_date DESC
    LIMIT ${days}
  `

  return {
    currentStreak: state.current_streak,
    longestStreak: state.longest_streak,
    missedDays: state.missed_days,
    cutoffTime: state.cutoff_time,
    updatedAt: state.updated_at.toISOString(),
    heatmap: dailyRows
      .map((row) => ({
        date: toDateKey(new Date(row.study_date)),
        actualMinutes: row.actual_minutes,
        targetMinutes: row.target_minutes,
        metTarget: Boolean(row.met_target),
        medal: row.medal,
      }))
      .reverse(),
  }
}
