import { prisma } from './db.js'
import { getProductivityOverview } from './productivity.js'
import { getStreakOverview } from './streak.js'

type AnalyticsPrediction = {
  predictedMinutes: number
  studyProbability: number
  confidenceScore: number
  explanation: string
  factors: {
    recentFrequency: number
    weekdayPattern: number
    streakMomentum: number
    productivityTrend: number
  }
  generatedAt: string
}

type CacheEntry = {
  signature: string
  value: AnalyticsPrediction
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const predictionCache = new Map<string, CacheEntry>()

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildExplanation(params: {
  probability: number
  predictedMinutes: number
  confidence: number
  recentFrequency: number
  weekdayPattern: number
  productivityDelta: number
  currentStreak: number
}) {
  const pieces: string[] = []

  if (params.probability >= 0.7) {
    pieces.push('You are likely to study tomorrow.')
  } else if (params.probability >= 0.45) {
    pieces.push('Tomorrow looks moderately likely for a study block.')
  } else {
    pieces.push('Tomorrow may be a low-study day unless you plan one intentionally.')
  }

  if (params.currentStreak >= 3) {
    pieces.push(`Current streak (${params.currentStreak}) supports continuity.`)
  }

  if (params.weekdayPattern >= 0.6) {
    pieces.push('This weekday has been strong for you recently.')
  } else if (params.weekdayPattern <= 0.25) {
    pieces.push('This weekday is historically lighter in your logs.')
  }

  if (params.productivityDelta > 0.08) {
    pieces.push('Productivity trend is improving.')
  } else if (params.productivityDelta < -0.08) {
    pieces.push('Productivity trend is slightly declining.')
  }

  if (params.confidence < 45) {
    pieces.push('Confidence is limited due to sparse recent data.')
  }

  pieces.push(`Expected minutes: ${params.predictedMinutes}.`)
  return pieces.join(' ')
}

export async function getAnalyticsPrediction(userId: string): Promise<AnalyticsPrediction> {
  const sessions = await prisma.studySession.findMany({
    where: {
      userId,
      startTime: { gte: addDays(new Date(), -84) },
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
    },
  })

  const streak = await getStreakOverview(userId, 30)
  const productivity = await getProductivityOverview(userId, 14)

  const latestSessionTs =
    sessions.length > 0 ? new Date(sessions[sessions.length - 1]!.startTime).getTime() : 0
  const signature = [
    sessions.length,
    latestSessionTs,
    streak.currentStreak,
    streak.updatedAt,
    productivity.todayScore,
    productivity.updatedAt,
  ].join(':')

  const cached = predictionCache.get(userId)
  if (cached && cached.signature === signature && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const today = new Date()
  const recentWindowDays = 14
  const recentStart = addDays(today, -(recentWindowDays - 1))
  const tomorrow = addDays(today, 1)
  const tomorrowWeekday = tomorrow.getDay() === 0 ? 7 : tomorrow.getDay()

  const minutesByDay = new Map<string, number>()
  sessions.forEach((session) => {
    const key = dateKey(new Date(session.startTime))
    minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + session.durationMinutes)
  })

  let recentActiveDays = 0
  let recentTotalMinutes = 0
  for (let i = 0; i < recentWindowDays; i += 1) {
    const date = addDays(recentStart, i)
    const minutes = minutesByDay.get(dateKey(date)) ?? 0
    if (minutes > 0) recentActiveDays += 1
    recentTotalMinutes += minutes
  }

  const recentFrequency = recentActiveDays / recentWindowDays
  const recentDailyAverage = recentTotalMinutes / recentWindowDays

  const weekdaySamples: number[] = []
  for (let i = 1; i <= 8; i += 1) {
    const sampleDate = addDays(tomorrow, -i * 7)
    const minutes = minutesByDay.get(dateKey(sampleDate)) ?? 0
    weekdaySamples.push(minutes)
  }
  const weekdayPattern = weekdaySamples.filter((value) => value > 0).length / Math.max(1, weekdaySamples.length)
  const weekdayAverageMinutes = average(weekdaySamples)

  const streakMomentum = clamp(streak.currentStreak / 14, 0, 1)

  const productivityScores = productivity.weeklyTrend.map((row) => row.score)
  const productivityAverage = average(productivityScores) / 100
  const productivityDeltaRaw =
    productivityScores.length >= 6
      ? average(productivityScores.slice(-3)) - average(productivityScores.slice(0, 3))
      : 0
  const productivityDelta = clamp(productivityDeltaRaw / 20, -1, 1)

  const studyProbability = clamp(
    0.34 * recentFrequency +
      0.32 * weekdayPattern +
      0.14 * streakMomentum +
      0.2 * productivityAverage +
      0.08 * productivityDelta,
    0.05,
    0.97,
  )

  const averageSessionDuration = average(sessions.map((session) => session.durationMinutes))
  let baselineMinutes = 0.55 * recentDailyAverage + 0.45 * weekdayAverageMinutes
  if (baselineMinutes < 8 && averageSessionDuration > 0) {
    baselineMinutes = averageSessionDuration * 0.7
  }

  let predictedMinutes = baselineMinutes * (0.55 + 0.9 * studyProbability)
  predictedMinutes += Math.min(20, streak.currentStreak * 2)
  if (productivityDelta < -0.2) predictedMinutes *= 0.9
  predictedMinutes = clamp(Math.round(predictedMinutes / 5) * 5, 0, 360)

  const dataVolume = clamp(sessions.length / 45, 0, 1)
  const signalAgreement = 1 - Math.abs(recentFrequency - weekdayPattern)
  const trendStability = 1 - Math.abs(productivityDelta)
  const confidenceScore = Math.round(
    clamp((0.55 * dataVolume + 0.25 * signalAgreement + 0.2 * trendStability) * 100, 10, 95),
  )

  const result: AnalyticsPrediction = {
    predictedMinutes,
    studyProbability: Number(studyProbability.toFixed(3)),
    confidenceScore,
    explanation: buildExplanation({
      probability: studyProbability,
      predictedMinutes,
      confidence: confidenceScore,
      recentFrequency,
      weekdayPattern,
      productivityDelta,
      currentStreak: streak.currentStreak,
    }),
    factors: {
      recentFrequency: Number(recentFrequency.toFixed(3)),
      weekdayPattern: Number(weekdayPattern.toFixed(3)),
      streakMomentum: Number(streakMomentum.toFixed(3)),
      productivityTrend: Number(productivityDelta.toFixed(3)),
    },
    generatedAt: new Date().toISOString(),
  }

  predictionCache.set(userId, {
    signature,
    value: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return result
}
