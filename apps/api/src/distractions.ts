import { prisma } from './db.js'

export const DISTRACTION_TYPES = [
  'phone',
  'social_media',
  'noise',
  'tiredness',
  'other',
] as const

export type DistractionType = (typeof DISTRACTION_TYPES)[number]

type DistractionRow = {
  id: number
  session_id: string
  type: DistractionType
  minutes_lost: number
  note: string | null
  created_at: Date
}

function toLabel(type: DistractionType) {
  if (type === 'social_media') return 'Social media'
  if (type === 'phone') return 'Phone'
  if (type === 'noise') return 'Noise'
  if (type === 'tiredness') return 'Tiredness'
  return 'Other'
}

export async function ensureDistractionTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS session_distractions (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      session_id VARCHAR(191) NOT NULL,
      type VARCHAR(32) NOT NULL,
      minutes_lost INT NOT NULL DEFAULT 0,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_distractions_user (user_id),
      INDEX idx_distractions_session (session_id)
    )
  `)
}

export function isDistractionType(value: string): value is DistractionType {
  return (DISTRACTION_TYPES as readonly string[]).includes(value)
}

export async function addDistraction(params: {
  userId: string
  sessionId: string
  type: DistractionType
  minutesLost: number
  note?: string
}) {
  await prisma.$executeRaw`
    INSERT INTO session_distractions (user_id, session_id, type, minutes_lost, note)
    VALUES (${params.userId}, ${params.sessionId}, ${params.type}, ${params.minutesLost}, ${params.note?.trim() || null})
  `

  const rows = await prisma.$queryRaw<DistractionRow[]>`
    SELECT id, session_id, type, minutes_lost, note, created_at
    FROM session_distractions
    WHERE user_id = ${params.userId} AND session_id = ${params.sessionId}
    ORDER BY created_at DESC
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  return {
    id: String(row.id),
    sessionId: row.session_id,
    type: row.type,
    label: toLabel(row.type),
    minutesLost: row.minutes_lost,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  }
}

export async function getSessionDistractions(userId: string, sessionId: string) {
  const rows = await prisma.$queryRaw<DistractionRow[]>`
    SELECT id, session_id, type, minutes_lost, note, created_at
    FROM session_distractions
    WHERE user_id = ${userId} AND session_id = ${sessionId}
    ORDER BY created_at DESC
  `

  return rows.map((row) => ({
    id: String(row.id),
    sessionId: row.session_id,
    type: row.type,
    label: toLabel(row.type),
    minutesLost: row.minutes_lost,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  }))
}

export async function getDistractionAnalytics(userId: string, days: number) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.round(days))) : 30

  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000)
  const sessions = await prisma.studySession.findMany({
    where: {
      userId,
      startTime: { gte: since },
    },
    select: { id: true },
  })

  if (sessions.length === 0) {
    return {
      days: safeDays,
      totalMinutesLost: 0,
      totalEvents: 0,
      mostCommon: null,
      byType: [],
      suggestions: ['Distraction profile looks stable. Keep your current setup and routine.'],
    }
  }

  const validSessionIds = new Set(sessions.map((session) => session.id))
  const rows = await prisma.$queryRaw<DistractionRow[]>`
    SELECT id, session_id, type, minutes_lost, note, created_at
    FROM session_distractions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `

  const buckets = new Map<
    DistractionType,
    {
      type: DistractionType
      count: number
      minutesLost: number
    }
  >()

  for (const row of rows) {
    if (!validSessionIds.has(row.session_id)) continue
    const current = buckets.get(row.type) ?? {
      type: row.type,
      count: 0,
      minutesLost: 0,
    }
    current.count += 1
    current.minutesLost += Number(row.minutes_lost)
    buckets.set(row.type, current)
  }

  const byType = Array.from(buckets.values())
    .sort((a, b) => b.minutesLost - a.minutesLost || b.count - a.count)
    .map((item) => ({
      type: item.type,
      label: toLabel(item.type),
      count: item.count,
      minutesLost: item.minutesLost,
    }))

  const totalMinutesLost = byType.reduce((sum, row) => sum + row.minutesLost, 0)
  const totalEvents = byType.reduce((sum, row) => sum + row.count, 0)

  const top = byType[0]
  const mostCommon = top
    ? {
        type: top.type,
        label: toLabel(top.type),
        count: top.count,
        minutesLost: top.minutesLost,
      }
    : null

  const suggestions: string[] = []
  if (mostCommon?.type === 'phone') {
    suggestions.push('Enable Focus mode and keep your phone out of arm reach during sessions.')
  }
  if (mostCommon?.type === 'social_media') {
    suggestions.push('Use site blockers during deep work blocks to reduce social media pull.')
  }
  if (mostCommon?.type === 'noise') {
    suggestions.push('Try noise-canceling audio or move to a quieter study environment.')
  }
  if (mostCommon?.type === 'tiredness') {
    suggestions.push('Shorten sessions slightly and insert deliberate breaks to sustain energy.')
  }
  if (totalMinutesLost >= 90) {
    suggestions.push('You lost significant focus time this period. Consider fewer but higher-quality sessions.')
  }
  if (suggestions.length === 0) {
    suggestions.push('Distraction profile looks stable. Keep your current setup and routine.')
  }

  return {
    days: safeDays,
    totalMinutesLost,
    totalEvents,
    mostCommon,
    byType,
    suggestions,
  }
}
