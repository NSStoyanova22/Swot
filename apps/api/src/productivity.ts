import { prisma } from './db.js'

type ProductivityDailyRow = {
  study_date: Date
  score: number
  actual_minutes: number
  target_minutes: number
  sessions_count: number
  target_score: number
  consistency_score: number
  session_length_score: number
  break_score: number
}

type ProductivityStateRow = {
  today_score: number
  weekly_average_score: number
  updated_at: Date
}

type WorkingDay = {
  dateKey: string
  date: Date
  actualMinutes: number
  targetMinutes: number
  sessionsCount: number
  avgSessionLength: number
  breakUsageRatio: number
  metTarget: boolean
  targetCompletionRatio: number
  consistencyRatio: number
  targetScore: number
  consistencyScore: number
  sessionLengthScore: number
  breakScore: number
  score: number
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
  return toDateKey(startOfDay(shifted))
}

function weekdayMonToSun(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay()
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sessionLengthScore(avgSessionLength: number) {
  if (avgSessionLength <= 0) return 0
  const ideal = 45
  const tolerance = 35
  const closeness = clamp(1 - Math.abs(avgSessionLength - ideal) / tolerance, 0, 1)
  return Math.round(closeness * 20)
}

function breakScore(usageRatio: number) {
  if (!Number.isFinite(usageRatio)) return 0
  const ideal = 0.35
  const tolerance = 0.35
  const closeness = clamp(1 - Math.abs(usageRatio - ideal) / tolerance, 0, 1)
  return Math.round(closeness * 15)
}

function buildSummary(today: WorkingDay) {
  const pieces: string[] = []

  if (today.targetScore >= 30) {
    pieces.push('You are consistently hitting target progress.')
  } else {
    pieces.push('Target completion is the biggest opportunity today.')
  }

  if (today.sessionLengthScore >= 14) {
    pieces.push('Session lengths are in a productive range.')
  } else {
    pieces.push('Try keeping sessions closer to 30-60 minutes.')
  }

  if (today.breakScore >= 10) {
    pieces.push('Break habits look balanced.')
  }

  return pieces.join(' ')
}

export async function ensureProductivityTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS productivity_daily_stats (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      study_date DATE NOT NULL,
      score INT NOT NULL,
      actual_minutes INT NOT NULL,
      target_minutes INT NOT NULL,
      sessions_count INT NOT NULL,
      avg_session_length DECIMAL(8,2) NOT NULL,
      break_usage_ratio DECIMAL(8,4) NOT NULL,
      target_completion_ratio DECIMAL(8,4) NOT NULL,
      consistency_ratio DECIMAL(8,4) NOT NULL,
      target_score INT NOT NULL,
      consistency_score INT NOT NULL,
      session_length_score INT NOT NULL,
      break_score INT NOT NULL,
      UNIQUE KEY uniq_productivity_user_day (user_id, study_date),
      INDEX idx_productivity_user_day (user_id, study_date)
    )
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS productivity_state (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      today_score INT NOT NULL DEFAULT 0,
      weekly_average_score DECIMAL(8,2) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)
}

export async function recomputeAndStoreProductivity(userId: string) {
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

  const sessionsByDay = new Map<string, Array<{ duration: number; breakMinutes: number }>>()
  sessions.forEach((session) => {
    const key = toStudyDayKey(new Date(session.startTime), cutoffMinutes)
    const current = sessionsByDay.get(key) ?? []
    current.push({ duration: session.durationMinutes, breakMinutes: session.breakMinutes })
    sessionsByDay.set(key, current)
  })

  const todayKey = toStudyDayKey(new Date(), cutoffMinutes)
  const todayDay = fromDateKey(todayKey)

  const firstDay =
    sessions.length > 0
      ? fromDateKey(toStudyDayKey(new Date(sessions[0]!.startTime), cutoffMinutes))
      : todayDay

  const rows: WorkingDay[] = []

  for (let cursor = firstDay; cursor.getTime() <= todayDay.getTime(); cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor)
    const daySessions = sessionsByDay.get(key) ?? []
    const actualMinutes = daySessions.reduce((sum, session) => sum + session.duration, 0)
    const sessionsCount = daySessions.length
    const avgSessionLength = average(daySessions.map((session) => session.duration))
    const breakUsageRatio =
      sessionsCount > 0
        ? daySessions.filter((session) => session.breakMinutes > 0).length / sessionsCount
        : 0

    const targetMinutes = targetByWeekday.get(weekdayMonToSun(cursor)) ?? 0
    const targetCompletionRatio =
      targetMinutes > 0 ? clamp(actualMinutes / targetMinutes, 0, 1) : sessionsCount > 0 ? 1 : 0
    const metTarget = targetCompletionRatio >= 1

    rows.push({
      dateKey: key,
      date: cursor,
      actualMinutes,
      targetMinutes,
      sessionsCount,
      avgSessionLength,
      breakUsageRatio,
      metTarget,
      targetCompletionRatio,
      consistencyRatio: 0,
      targetScore: 0,
      consistencyScore: 0,
      sessionLengthScore: 0,
      breakScore: 0,
      score: 0,
    })
  }

  rows.forEach((row, index) => {
    const start = Math.max(0, index - 6)
    const windowRows = rows.slice(start, index + 1)
    const metCount = windowRows.filter((entry) => entry.metTarget).length
    row.consistencyRatio = windowRows.length > 0 ? metCount / windowRows.length : 0

    row.targetScore = Math.round(row.targetCompletionRatio * 40)
    row.consistencyScore = Math.round(row.consistencyRatio * 25)
    row.sessionLengthScore = sessionLengthScore(row.avgSessionLength)
    row.breakScore = breakScore(row.breakUsageRatio)
    row.score = clamp(
      row.targetScore + row.consistencyScore + row.sessionLengthScore + row.breakScore,
      0,
      100,
    )
  })

  const last7 = rows.slice(-7)
  const today = rows[rows.length - 1] ?? {
    score: 0,
  }
  const weeklyAverage = average(last7.map((row) => row.score))

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM productivity_daily_stats WHERE user_id = ${userId}`

    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO productivity_daily_stats (
          user_id,
          study_date,
          score,
          actual_minutes,
          target_minutes,
          sessions_count,
          avg_session_length,
          break_usage_ratio,
          target_completion_ratio,
          consistency_ratio,
          target_score,
          consistency_score,
          session_length_score,
          break_score
        ) VALUES (
          ${userId},
          ${row.dateKey},
          ${row.score},
          ${Math.round(row.actualMinutes)},
          ${Math.round(row.targetMinutes)},
          ${row.sessionsCount},
          ${row.avgSessionLength.toFixed(2)},
          ${row.breakUsageRatio.toFixed(4)},
          ${row.targetCompletionRatio.toFixed(4)},
          ${row.consistencyRatio.toFixed(4)},
          ${row.targetScore},
          ${row.consistencyScore},
          ${row.sessionLengthScore},
          ${row.breakScore}
        )
      `
    }

    await tx.$executeRaw`
      INSERT INTO productivity_state (user_id, today_score, weekly_average_score)
      VALUES (${userId}, ${Math.round(today.score)}, ${weeklyAverage.toFixed(2)})
      ON DUPLICATE KEY UPDATE
        today_score = VALUES(today_score),
        weekly_average_score = VALUES(weekly_average_score),
        updated_at = CURRENT_TIMESTAMP
    `
  })
}

export async function getProductivityOverview(userId: string, trendDays = 7) {
  const stateRows = await prisma.$queryRaw<ProductivityStateRow[]>`
    SELECT today_score, weekly_average_score, updated_at
    FROM productivity_state
    WHERE user_id = ${userId}
    LIMIT 1
  `

  if (stateRows.length === 0) {
    await recomputeAndStoreProductivity(userId)
  }

  const latestRows = await prisma.$queryRaw<ProductivityDailyRow[]>`
    SELECT study_date, score, actual_minutes, target_minutes, sessions_count, target_score, consistency_score, session_length_score, break_score
    FROM productivity_daily_stats
    WHERE user_id = ${userId}
    ORDER BY study_date DESC
    LIMIT ${trendDays}
  `

  const todayRow = latestRows[0] ?? null

  const state =
    stateRows[0] ??
    (await prisma.$queryRaw<ProductivityStateRow[]>`
      SELECT today_score, weekly_average_score, updated_at
      FROM productivity_state
      WHERE user_id = ${userId}
      LIMIT 1
    `)[0] ?? {
      today_score: 0,
      weekly_average_score: 0,
      updated_at: new Date(),
    }

  return {
    todayScore: state.today_score,
    weeklyAverage: Number(state.weekly_average_score),
    updatedAt: state.updated_at.toISOString(),
    explanation: {
      targetCompletion: todayRow?.target_score ?? 0,
      consistency: todayRow?.consistency_score ?? 0,
      sessionLength: todayRow?.session_length_score ?? 0,
      breaks: todayRow?.break_score ?? 0,
      summary: todayRow
        ? buildSummary({
            dateKey: '',
            date: new Date(),
            actualMinutes: todayRow.actual_minutes,
            targetMinutes: todayRow.target_minutes,
            sessionsCount: todayRow.sessions_count,
            avgSessionLength: 0,
            breakUsageRatio: 0,
            metTarget: false,
            targetCompletionRatio: 0,
            consistencyRatio: 0,
            targetScore: todayRow.target_score,
            consistencyScore: todayRow.consistency_score,
            sessionLengthScore: todayRow.session_length_score,
            breakScore: todayRow.break_score,
            score: todayRow.score,
          })
        : 'Log sessions to get personalized productivity guidance.',
    },
    weeklyTrend: latestRows
      .slice()
      .reverse()
      .map((row) => ({
        date: toDateKey(new Date(row.study_date)),
        score: row.score,
        actualMinutes: row.actual_minutes,
        targetMinutes: row.target_minutes,
        sessionsCount: row.sessions_count,
      })),
  }
}
