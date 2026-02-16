import { prisma } from './db.js'

type TimerRecommendation = {
  adaptiveEnabled: boolean
  sessionCount: number
  baseFocusMinutes: number
  recommendedFocusMinutes: number
  appliedDeltaMinutes: number
  canAdapt: boolean
  explanation: string
  signals: {
    consistencyScore: number
    completionRatio: number
    earlyCancelRatio: number
    breakHeavyRatio: number
    recentSessions: number
    previousSessions: number
  }
  generatedAt: string
}

type CacheEntry = {
  signature: string
  value: TimerRecommendation
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const recommendationCache = new Map<string, CacheEntry>()

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildSignature(params: {
  baseFocusMinutes: number
  adaptiveEnabled: boolean
  sessions: Array<{ durationMinutes: number; breakMinutes: number; startTime: Date }>
}) {
  const count = params.sessions.length
  if (count === 0) return `${params.baseFocusMinutes}:${params.adaptiveEnabled}:empty`
  const totals = params.sessions.reduce(
    (acc, session) => {
      acc.duration += session.durationMinutes
      acc.breaks += session.breakMinutes
      const ts = new Date(session.startTime).getTime()
      if (ts > acc.latest) acc.latest = ts
      return acc
    },
    { duration: 0, breaks: 0, latest: 0 },
  )
  return `${params.baseFocusMinutes}:${params.adaptiveEnabled}:${count}:${totals.duration}:${totals.breaks}:${totals.latest}`
}

function fromDbBool(value: unknown, fallback = true) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'bigint') return value === 1n
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return fallback
}

async function getAdaptiveEnabledFromDb(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ adaptive_enabled: number | bigint | null }>>`
    SELECT adaptive_enabled
    FROM Settings
    WHERE userId = ${userId}
    LIMIT 1
  `
  return fromDbBool(rows[0]?.adaptive_enabled, true)
}

export async function ensureAdaptiveTimerTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS timer_adaptation_history (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      recommended_focus_minutes INT NOT NULL,
      base_focus_minutes INT NOT NULL,
      applied_delta_minutes INT NOT NULL,
      reason VARCHAR(255) NOT NULL,
      metrics_json TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_timer_adapt_user_created (user_id, created_at)
    )
  `)

  const columnRows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'Settings'
      AND COLUMN_NAME = 'adaptive_enabled'
  `
  const hasColumn = Number(columnRows[0]?.count ?? 0) > 0
  if (!hasColumn) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE Settings
      ADD COLUMN adaptive_enabled TINYINT(1) NOT NULL DEFAULT 1
    `)
  }
}

export async function setAdaptiveEnabled(userId: string, enabled: boolean) {
  await prisma.$executeRaw`
    UPDATE Settings
    SET adaptive_enabled = ${enabled ? 1 : 0}
    WHERE userId = ${userId}
  `
}

export async function getAdaptiveEnabled(userId: string) {
  return getAdaptiveEnabledFromDb(userId)
}

export async function getTimerRecommendation(userId: string): Promise<TimerRecommendation> {
  const [settings, adaptiveEnabled, sessions] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    getAdaptiveEnabledFromDb(userId),
    prisma.studySession.findMany({
      where: {
        userId,
        startTime: { gte: addDays(new Date(), -56) },
      },
      orderBy: { startTime: 'asc' },
      select: {
        durationMinutes: true,
        breakMinutes: true,
        startTime: true,
      },
    }),
  ])

  const baseFocusMinutes = Math.max(10, settings?.shortSessionMinutes ?? 25)
  const signature = buildSignature({
    baseFocusMinutes,
    adaptiveEnabled,
    sessions: sessions.map((session) => ({
      durationMinutes: session.durationMinutes,
      breakMinutes: session.breakMinutes,
      startTime: new Date(session.startTime),
    })),
  })

  const cached = recommendationCache.get(userId)
  if (cached && cached.signature === signature && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const sessionCount = sessions.length
  const canAdapt = adaptiveEnabled && sessionCount >= 5

  const recentDaysWindow = 14
  const today = new Date()
  const recentStart = addDays(today, -(recentDaysWindow - 1))
  const previousStart = addDays(recentStart, -recentDaysWindow)
  const previousEnd = addDays(recentStart, -1)

  const recentSessions = sessions.filter((session) => new Date(session.startTime) >= recentStart)
  const previousSessions = sessions.filter((session) => {
    const start = new Date(session.startTime)
    return start >= previousStart && start <= previousEnd
  })

  const base = Math.max(10, baseFocusMinutes)
  const completionRatio =
    recentSessions.filter((session) => session.durationMinutes >= base * 0.9).length /
    Math.max(1, recentSessions.length)
  const earlyCancelRatio =
    recentSessions.filter((session) => session.durationMinutes < base * 0.6).length /
    Math.max(1, recentSessions.length)
  const breakHeavyRatio =
    recentSessions.filter((session) => {
      const breakRatio = session.durationMinutes > 0 ? session.breakMinutes / session.durationMinutes : 0
      return session.breakMinutes >= 12 || breakRatio >= 0.25
    }).length / Math.max(1, recentSessions.length)

  const daySet = new Set<string>()
  recentSessions.forEach((session) => {
    daySet.add(dateKey(new Date(session.startTime)))
  })
  const consistencyScore = Math.round((daySet.size / recentDaysWindow) * 100)

  let delta = 0
  const reasons: string[] = []

  if (!canAdapt) {
    reasons.push(
      adaptiveEnabled
        ? 'Need at least 5 sessions before adaptation can start.'
        : 'Adaptive mode is currently disabled in settings.',
    )
  } else {
    if (completionRatio >= 0.7 && consistencyScore >= 45 && earlyCancelRatio <= 0.2) {
      delta += 5
      reasons.push('Strong consistency and completion rate.')
    }

    if (completionRatio >= 0.82 && consistencyScore >= 60 && breakHeavyRatio <= 0.25) {
      delta += 5
      reasons.push('High-quality focus blocks with manageable breaks.')
    }

    if (earlyCancelRatio >= 0.35) {
      delta -= 10
      reasons.push('Many focus sessions end early.')
    } else if (earlyCancelRatio >= 0.2) {
      delta -= 5
      reasons.push('Some focus sessions end earlier than planned.')
    }

    if (breakHeavyRatio >= 0.45) {
      delta -= 10
      reasons.push('Break load is high in recent sessions.')
    } else if (breakHeavyRatio >= 0.3) {
      delta -= 5
      reasons.push('Break frequency suggests cognitive fatigue.')
    }

    const previousCount = previousSessions.length
    const recentCount = recentSessions.length
    if (previousCount >= 4 && recentCount < previousCount * 0.7) {
      delta -= 5
      reasons.push('Recent session frequency declined.')
    }
  }

  const recommendedFocusMinutes = canAdapt
    ? clamp(roundToStep(base + delta, 5), 10, 90)
    : base
  const appliedDeltaMinutes = recommendedFocusMinutes - base

  const explanation =
    reasons.length > 0
      ? reasons.join(' ')
      : 'Your recent study pattern is stable. Keep current focus length.'

  const payload: TimerRecommendation = {
    adaptiveEnabled,
    sessionCount,
    baseFocusMinutes: base,
    recommendedFocusMinutes,
    appliedDeltaMinutes,
    canAdapt,
    explanation,
    signals: {
      consistencyScore,
      completionRatio: Number(completionRatio.toFixed(3)),
      earlyCancelRatio: Number(earlyCancelRatio.toFixed(3)),
      breakHeavyRatio: Number(breakHeavyRatio.toFixed(3)),
      recentSessions: recentSessions.length,
      previousSessions: previousSessions.length,
    },
    generatedAt: new Date().toISOString(),
  }

  recommendationCache.set(userId, {
    signature,
    value: payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  const lastRows = await prisma.$queryRaw<
    Array<{ recommended_focus_minutes: number; created_at: Date }>
  >`
    SELECT recommended_focus_minutes, created_at
    FROM timer_adaptation_history
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 1
  `
  const last = lastRows[0]
  const shouldWriteHistory =
    !last ||
    last.recommended_focus_minutes !== recommendedFocusMinutes ||
    Date.now() - new Date(last.created_at).getTime() > 24 * 60 * 60 * 1000

  if (shouldWriteHistory) {
    await prisma.$executeRaw`
      INSERT INTO timer_adaptation_history (
        user_id,
        recommended_focus_minutes,
        base_focus_minutes,
        applied_delta_minutes,
        reason,
        metrics_json
      )
      VALUES (
        ${userId},
        ${recommendedFocusMinutes},
        ${base},
        ${appliedDeltaMinutes},
        ${explanation.slice(0, 255)},
        ${JSON.stringify(payload.signals)}
      )
    `
  }

  return payload
}
