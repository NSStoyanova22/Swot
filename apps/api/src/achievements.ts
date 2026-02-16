import { prisma } from './db.js'

type AchievementCode =
  | 'active_day'
  | 'early_bird'
  | 'night_owl'
  | 'daily_streak'
  | 'weekly_goal'
  | 'monthly_goal'
  | 'course_badge'
  | 'school_year_badge'

type Medal = 'none' | 'bronze' | 'silver' | 'gold'

type EarnedAchievementRow = {
  code: AchievementCode
  level_key: string
  metadata: string | null
  earned_at: Date
}

const MEDAL_THRESHOLDS = {
  bronze: 60,
  silver: 120,
  gold: 180,
} as const

const STREAK_LEVELS = [3, 7, 14, 30]
const COURSE_BADGE_MINUTES = 600
const SCHOOL_YEAR_BADGE_MINUTES = 5000

const ACHIEVEMENT_DEFINITIONS: Array<{
  code: AchievementCode
  title: string
  description: string
  icon: string
  levelBased?: boolean
}> = [
  {
    code: 'active_day',
    title: 'Active Day',
    description: 'Complete at least one study session in a day.',
    icon: 'flame',
  },
  {
    code: 'early_bird',
    title: 'Early Bird',
    description: 'Start a session before 06:00.',
    icon: 'sunrise',
  },
  {
    code: 'night_owl',
    title: 'Night Owl',
    description: 'Finish a session at or after 22:00.',
    icon: 'moon',
  },
  {
    code: 'daily_streak',
    title: 'Daily Study Streak',
    description: 'Keep consecutive active days. Levels: 3, 7, 14, 30.',
    icon: 'zap',
    levelBased: true,
  },
  {
    code: 'weekly_goal',
    title: 'Weekly Goal Badge',
    description: 'Reach or exceed your current weekly target.',
    icon: 'target',
  },
  {
    code: 'monthly_goal',
    title: 'Monthly Goal Badge',
    description: 'Reach four times your weekly target in the current month.',
    icon: 'calendar-check',
  },
  {
    code: 'course_badge',
    title: 'Course Badge',
    description: `Log at least ${COURSE_BADGE_MINUTES} minutes in any single course.`,
    icon: 'book-open-check',
  },
  {
    code: 'school_year_badge',
    title: 'School Year Badge',
    description: `Log at least ${SCHOOL_YEAR_BADGE_MINUTES} minutes in the current school year.`,
    icon: 'graduation-cap',
  },
]

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function calculateMedal(minutes: number): Medal {
  if (minutes >= MEDAL_THRESHOLDS.gold) return 'gold'
  if (minutes >= MEDAL_THRESHOLDS.silver) return 'silver'
  if (minutes >= MEDAL_THRESHOLDS.bronze) return 'bronze'
  return 'none'
}

function startOfCurrentSchoolYear(now: Date) {
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  return new Date(year, 8, 1)
}

async function earnAchievement(
  userId: string,
  code: AchievementCode,
  levelKey = '',
  metadata: Record<string, unknown> = {},
) {
  await prisma.$executeRaw`
    INSERT IGNORE INTO earned_achievements (user_id, code, level_key, metadata)
    VALUES (${userId}, ${code}, ${levelKey}, ${JSON.stringify(metadata)})
  `
}

export async function ensureAchievementsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS earned_achievements (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      code VARCHAR(64) NOT NULL,
      level_key VARCHAR(64) NOT NULL DEFAULT '',
      metadata JSON NULL,
      earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_code_level (user_id, code, level_key),
      INDEX idx_achievements_user (user_id)
    )
  `)
}

export async function recomputeAndStoreAchievements(userId: string) {
  const [sessions, targets] = await Promise.all([
    prisma.studySession.findMany({
      where: { userId },
      include: { course: true, activity: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.dailyTarget.findMany({ where: { userId } }),
  ])

  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)
  const mondayOffset = (today.getDay() + 6) % 7
  const weekStart = addDays(today, -mondayOffset)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const schoolYearStart = startOfCurrentSchoolYear(today)

  const byDayMinutes = new Map<string, number>()
  const byCourseMinutes = new Map<string, number>()
  let hasEarlyBird = false
  let hasNightOwl = false

  sessions.forEach((session) => {
    const start = new Date(session.startTime)
    const end = new Date(session.endTime)

    const key = dateKey(start)
    byDayMinutes.set(key, (byDayMinutes.get(key) ?? 0) + session.durationMinutes)

    byCourseMinutes.set(session.courseId, (byCourseMinutes.get(session.courseId) ?? 0) + session.durationMinutes)

    if (start.getHours() < 6) hasEarlyBird = true
    if (end.getHours() >= 22) hasNightOwl = true
  })

  const medalsByDay = Array.from(byDayMinutes.entries()).map(([key, minutes]) => ({
    date: key,
    minutes,
    medal: calculateMedal(minutes),
  }))

  const medals = medalsByDay.reduce(
    (acc, day) => {
      if (day.medal === 'bronze') acc.bronze += 1
      if (day.medal === 'silver') acc.silver += 1
      if (day.medal === 'gold') acc.gold += 1
      return acc
    },
    { bronze: 0, silver: 0, gold: 0 },
  )

  if (sessions.length > 0) {
    await earnAchievement(userId, 'active_day')
  }
  if (hasEarlyBird) {
    await earnAchievement(userId, 'early_bird')
  }
  if (hasNightOwl) {
    await earnAchievement(userId, 'night_owl')
  }

  let currentStreak = 0
  for (let cursor = today; ; cursor = addDays(cursor, -1)) {
    const key = dateKey(cursor)
    if ((byDayMinutes.get(key) ?? 0) > 0) {
      currentStreak += 1
    } else {
      break
    }
  }

  for (const level of STREAK_LEVELS) {
    if (currentStreak >= level) {
      await earnAchievement(userId, 'daily_streak', String(level), { level })
    }
  }

  const weeklyTarget = targets.reduce((sum, target) => sum + target.targetMinutes, 0)
  const weeklyMinutes = sessions.reduce((sum, session) => {
    const startedAt = new Date(session.startTime).getTime()
    if (startedAt >= weekStart.getTime() && startedAt < tomorrow.getTime()) {
      return sum + session.durationMinutes
    }
    return sum
  }, 0)

  if (weeklyTarget > 0 && weeklyMinutes >= weeklyTarget) {
    await earnAchievement(userId, 'weekly_goal')
  }

  const monthlyMinutes = sessions.reduce((sum, session) => {
    const startedAt = new Date(session.startTime).getTime()
    if (startedAt >= monthStart.getTime() && startedAt < tomorrow.getTime()) {
      return sum + session.durationMinutes
    }
    return sum
  }, 0)

  if (weeklyTarget > 0 && monthlyMinutes >= weeklyTarget * 4) {
    await earnAchievement(userId, 'monthly_goal')
  }

  const topCourse = Array.from(byCourseMinutes.entries()).sort((a, b) => b[1] - a[1])[0]
  if (topCourse && topCourse[1] >= COURSE_BADGE_MINUTES) {
    await earnAchievement(userId, 'course_badge')
  }

  const schoolYearMinutes = sessions.reduce((sum, session) => {
    const startedAt = new Date(session.startTime).getTime()
    if (startedAt >= schoolYearStart.getTime() && startedAt < tomorrow.getTime()) {
      return sum + session.durationMinutes
    }
    return sum
  }, 0)

  if (schoolYearMinutes >= SCHOOL_YEAR_BADGE_MINUTES) {
    await earnAchievement(userId, 'school_year_badge')
  }

  const earnedRows = await prisma.$queryRaw<EarnedAchievementRow[]>`
    SELECT code, level_key, metadata, earned_at
    FROM earned_achievements
    WHERE user_id = ${userId}
    ORDER BY earned_at ASC
  `

  const earnedByCode = new Map<AchievementCode, EarnedAchievementRow[]>()
  earnedRows.forEach((row) => {
    const current = earnedByCode.get(row.code) ?? []
    earnedByCode.set(row.code, [...current, row])
  })

  const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const rows = earnedByCode.get(definition.code) ?? []

    if (!definition.levelBased) {
      const earned = rows.length > 0
      return {
        code: definition.code,
        title: definition.title,
        description: definition.description,
        icon: definition.icon,
        earned,
        earnedAt: earned ? rows[0]?.earned_at.toISOString() : null,
        level: null,
      }
    }

    const levels = rows
      .map((row) => Number(row.level_key))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)

    const highestLevel = levels.length > 0 ? levels[levels.length - 1] : null

    return {
      code: definition.code,
      title: definition.title,
      description: definition.description,
      icon: definition.icon,
      earned: levels.length > 0,
      earnedAt: rows[0]?.earned_at.toISOString() ?? null,
      level: highestLevel,
    }
  })

  return {
    medals,
    medalThresholds: MEDAL_THRESHOLDS,
    achievements,
  }
}
