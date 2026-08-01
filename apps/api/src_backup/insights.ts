import { prisma } from './db.js'
import { getProductivityOverview } from './productivity.js'

type BurnoutLevel = 'low' | 'medium' | 'high'

type InsightsPayload = {
  sessionCount: number
  unlocked: boolean
  generatedAt: string
  bestStudyHourRange: {
    label: string
    startHour: number
    endHour: number
    minutes: number
  } | null
  bestStudyWeekday: {
    weekday: number
    label: string
    minutes: number
  } | null
  averageSessionDurationMinutes: number
  consistencyScore: number
  burnoutRisk: {
    level: BurnoutLevel
    score: number
    reason: string
  }
  recommendedBreakFrequencyMinutes: number
  recommendations: string[]
  explanation: string
  charts: {
    weekdayMinutes: Array<{ day: string; minutes: number }>
    hourRangeMinutes: Array<{ range: string; minutes: number }>
    sessionTrend: Array<{ week: string; sessions: number; minutes: number }>
    productivityTrend: Array<{ date: string; score: number }>
  }
}

type CacheEntry = {
  signature: string
  value: InsightsPayload
  expiresAt: number
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

const hourRanges = [
  { label: 'Early morning (05:00-09:00)', startHour: 5, endHour: 9 },
  { label: 'Morning (09:00-13:00)', startHour: 9, endHour: 13 },
  { label: 'Afternoon (13:00-17:00)', startHour: 13, endHour: 17 },
  { label: 'Evening (17:00-21:00)', startHour: 17, endHour: 21 },
  { label: 'Night (21:00-05:00)', startHour: 21, endHour: 29 },
] as const

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

function stdDev(values: number[]) {
  if (values.length <= 1) return 0
  const avg = average(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function startOfWeekMonday(date: Date) {
  const dayIndex = (date.getDay() + 6) % 7
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -dayIndex)
}

function weekLabel(date: Date) {
  const start = startOfWeekMonday(date)
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const day = String(start.getDate()).padStart(2, '0')
  return `${start.getFullYear()}-${month}-${day}`
}

function hourRangeIndex(hour: number) {
  if (hour >= 5 && hour < 9) return 0
  if (hour >= 9 && hour < 13) return 1
  if (hour >= 13 && hour < 17) return 2
  if (hour >= 17 && hour < 21) return 3
  return 4
}

function computeConsistencyScore(dailyMinutes: number[]) {
  if (dailyMinutes.length === 0) return 0
  const activeDaysRatio = dailyMinutes.filter((value) => value > 0).length / dailyMinutes.length
  const avg = average(dailyMinutes)
  const deviation = stdDev(dailyMinutes)
  const stability = avg > 0 ? Math.max(0, 1 - deviation / Math.max(1, avg * 1.5)) : 0
  return Math.round((activeDaysRatio * 0.6 + stability * 0.4) * 100)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function burnoutFromTrends(params: {
  sessionTrend: Array<{ sessions: number; minutes: number }>
  productivityScores: number[]
  averageDuration: number
  breakUsageRatio: number
}) {
  const { sessionTrend, productivityScores, averageDuration, breakUsageRatio } = params
  let score = 0
  const reasons: string[] = []

  if (sessionTrend.length >= 2) {
    const midpoint = Math.floor(sessionTrend.length / 2)
    const first = sessionTrend.slice(0, midpoint)
    const second = sessionTrend.slice(midpoint)
    const firstAvg = average(first.map((row) => row.sessions))
    const secondAvg = average(second.map((row) => row.sessions))
    if (firstAvg > 0) {
      const decline = ((firstAvg - secondAvg) / firstAvg) * 100
      if (decline >= 30) {
        score += 35
        reasons.push('Session frequency has dropped sharply.')
      } else if (decline >= 15) {
        score += 20
        reasons.push('Session frequency is trending down.')
      }
    }
  }

  if (productivityScores.length >= 6) {
    const first = productivityScores.slice(0, 3)
    const second = productivityScores.slice(-3)
    const decline = average(first) - average(second)
    if (decline >= 12) {
      score += 35
      reasons.push('Productivity score has declined in recent days.')
    } else if (decline >= 6) {
      score += 20
      reasons.push('Productivity has softened recently.')
    }
  }

  if (averageDuration >= 90) {
    score += 20
    reasons.push('Average sessions are very long.')
  } else if (averageDuration >= 70) {
    score += 10
  }

  if (breakUsageRatio < 0.2) {
    score += 10
    reasons.push('Breaks are infrequent.')
  }

  const safeScore = clamp(Math.round(score), 0, 100)
  const level: BurnoutLevel = safeScore >= 65 ? 'high' : safeScore >= 35 ? 'medium' : 'low'
  const reason = reasons.length > 0 ? reasons.join(' ') : 'Current pace looks sustainable.'

  return { level, score: safeScore, reason }
}

function recommendedBreakFrequencyMinutes(averageSessionDuration: number, breakUsageRatio: number) {
  let frequency = 50
  if (averageSessionDuration >= 90) frequency = 20
  else if (averageSessionDuration >= 60) frequency = 30
  else if (averageSessionDuration >= 40) frequency = 40

  if (breakUsageRatio < 0.25) frequency -= 5
  if (breakUsageRatio > 0.65) frequency += 5
  frequency = clamp(frequency, 15, 60)

  return Math.round(frequency / 5) * 5
}

function buildSignature(sessions: Array<{ id: string; startTime: Date; durationMinutes: number; breakMinutes: number }>) {
  if (sessions.length === 0) return 'empty'
  const count = sessions.length
  const totalDuration = sessions.reduce((sum, row) => sum + row.durationMinutes, 0)
  const totalBreaks = sessions.reduce((sum, row) => sum + row.breakMinutes, 0)
  const latest = sessions.reduce((max, row) => Math.max(max, row.startTime.getTime()), 0)
  return `${count}:${totalDuration}:${totalBreaks}:${latest}`
}

export async function getAnalyticsInsights(userId: string): Promise<InsightsPayload> {
  const sessions = await prisma.studySession.findMany({
    where: { userId },
    orderBy: { startTime: 'asc' },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
      breakMinutes: true,
    },
  })

  const signature = buildSignature(sessions)
  const cached = cache.get(userId)
  if (cached && cached.signature === signature && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const sessionCount = sessions.length
  const generatedAt = new Date().toISOString()

  if (sessionCount < 5) {
    const lockedPayload: InsightsPayload = {
      sessionCount,
      unlocked: false,
      generatedAt,
      bestStudyHourRange: null,
      bestStudyWeekday: null,
      averageSessionDurationMinutes: 0,
      consistencyScore: 0,
      burnoutRisk: {
        level: 'low',
        score: 0,
        reason: 'Need at least 5 sessions to evaluate patterns.',
      },
      recommendedBreakFrequencyMinutes: 30,
      recommendations: ['Log at least 5 sessions to unlock personalized insights.'],
      explanation: 'Insights unlock once enough data is available.',
      charts: {
        weekdayMinutes: WEEKDAY_LABELS.map((day) => ({ day, minutes: 0 })),
        hourRangeMinutes: hourRanges.map((range) => ({ range: range.label, minutes: 0 })),
        sessionTrend: [],
        productivityTrend: [],
      },
    }

    cache.set(userId, {
      signature,
      value: lockedPayload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return lockedPayload
  }

  const weekdayMinutes = [0, 0, 0, 0, 0, 0, 0]
  const hourMinutes = [0, 0, 0, 0, 0]
  const dailyMap = new Map<string, number>()
  const weeklyMap = new Map<string, { sessions: number; minutes: number }>()

  for (const session of sessions) {
    const start = new Date(session.startTime)
    const weekday = (start.getDay() + 6) % 7
    const weekdayCurrent = weekdayMinutes[weekday] ?? 0
    weekdayMinutes[weekday] = weekdayCurrent + session.durationMinutes
    const hourIndex = hourRangeIndex(start.getHours())
    const hourCurrent = hourMinutes[hourIndex] ?? 0
    hourMinutes[hourIndex] = hourCurrent + session.durationMinutes

    const dayKey = dateKey(start)
    dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + session.durationMinutes)

    const week = weekLabel(start)
    const weekStats = weeklyMap.get(week) ?? { sessions: 0, minutes: 0 }
    weekStats.sessions += 1
    weekStats.minutes += session.durationMinutes
    weeklyMap.set(week, weekStats)
  }

  const weekdayChart = WEEKDAY_LABELS.map((day, index) => ({
    day,
    minutes: weekdayMinutes[index] ?? 0,
  }))
  const firstWeekday = WEEKDAY_LABELS[0] ?? 'Mon'
  let bestWeekdayEntry: { weekday: number; day: string; minutes: number } = {
    weekday: 1,
    day: firstWeekday,
    minutes: weekdayChart[0]?.minutes ?? 0,
  }
  weekdayChart.forEach((item, index) => {
    if (item.minutes > bestWeekdayEntry.minutes) {
      bestWeekdayEntry = {
        weekday: index + 1,
        day: item.day,
        minutes: item.minutes,
      }
    }
  })

  const hourChart = hourRanges.map((range, index) => ({
    range: range.label,
    minutes: hourMinutes[index] ?? 0,
    startHour: range.startHour,
    endHour: range.endHour > 24 ? range.endHour - 24 : range.endHour,
  }))
  let bestHour = hourChart[0] ?? {
    range: hourRanges[0]?.label ?? 'Early morning (05:00-09:00)',
    minutes: 0,
    startHour: 5,
    endHour: 9,
  }
  for (const item of hourChart) {
    if (item.minutes > bestHour.minutes) bestHour = item
  }

  const averageDuration = average(sessions.map((session) => session.durationMinutes))
  const breakUsageRatio =
    sessions.filter((session) => session.breakMinutes > 0).length / Math.max(1, sessions.length)

  const recentDays = 28
  const today = new Date()
  const dailySeries: number[] = []
  for (let i = recentDays - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i)
    dailySeries.push(dailyMap.get(dateKey(date)) ?? 0)
  }
  const consistencyScore = computeConsistencyScore(dailySeries)

  const sessionTrend = Array.from(weeklyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([week, stats]) => ({
      week,
      sessions: stats.sessions,
      minutes: stats.minutes,
    }))

  const productivity = await getProductivityOverview(userId, 14)
  const productivityTrend = productivity.weeklyTrend.map((day) => ({
    date: day.date,
    score: day.score,
  }))

  const burnoutRisk = burnoutFromTrends({
    sessionTrend,
    productivityScores: productivity.weeklyTrend.map((row) => row.score),
    averageDuration,
    breakUsageRatio,
  })

  const recommendedBreakFrequency = recommendedBreakFrequencyMinutes(averageDuration, breakUsageRatio)

  const recommendations = [
    `Prioritize ${bestWeekdayEntry.day} sessions for your hardest tasks.`,
    `Use ${bestHour.range.toLowerCase()} for deep focus blocks.`,
    `Aim for breaks about every ${recommendedBreakFrequency} minutes.`,
  ]

  if (burnoutRisk.level === 'high') {
    recommendations.push('Reduce block length temporarily and add one recovery day this week.')
  } else if (burnoutRisk.level === 'medium') {
    recommendations.push('Keep workload steady and monitor fatigue with shorter sessions.')
  }

  const payload: InsightsPayload = {
    sessionCount,
    unlocked: true,
    generatedAt,
    bestStudyHourRange: {
      label: bestHour.range,
      startHour: bestHour.startHour,
      endHour: bestHour.endHour,
      minutes: bestHour.minutes,
    },
    bestStudyWeekday: {
      weekday: bestWeekdayEntry.weekday,
      label: bestWeekdayEntry.day ?? firstWeekday,
      minutes: bestWeekdayEntry.minutes,
    },
    averageSessionDurationMinutes: Math.round(averageDuration),
    consistencyScore,
    burnoutRisk,
    recommendedBreakFrequencyMinutes: recommendedBreakFrequency,
    recommendations,
    explanation: 'These insights are computed from your existing sessions, targets, streak, and productivity trends.',
    charts: {
      weekdayMinutes: weekdayChart,
      hourRangeMinutes: hourChart.map((row) => ({ range: row.range, minutes: row.minutes })),
      sessionTrend,
      productivityTrend,
    },
  }

  cache.set(userId, {
    signature,
    value: payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return payload
}
