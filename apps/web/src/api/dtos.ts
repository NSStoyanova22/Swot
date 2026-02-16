export type HealthDto = {
  ok: boolean
  name: string
}

export type CourseDto = {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

export type ActivityDto = {
  id: string
  userId: string
  courseId: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
  course?: CourseDto
}

export type SessionDto = {
  id: string
  userId: string
  courseId: string
  activityId: string | null
  startTime: string
  endTime: string
  breakMinutes: number
  durationMinutes: number
  note: string | null
  createdAt: string
  updatedAt: string
  course: CourseDto
  activity: ActivityDto | null
}

export type CreateSessionDto = {
  courseId: string
  activityId?: string | null
  startTime: string
  endTime: string
  breakMinutes?: number
  note?: string
}

export type UpdateSessionDto = CreateSessionDto

export type SettingsDto = {
  id: string
  userId: string
  cutoffTime: string
  soundsEnabled: boolean
  shortSessionMinutes: number
  longSessionMinutes: number
  breakSessionMinutes: number
  adaptiveEnabled?: boolean
  createdAt: string
}

export type DailyTargetDto = {
  id: string
  userId: string
  weekday: number
  targetMinutes: number
  createdAt: string
}

export type MeDto = {
  id: string
  name: string
  createdAt: string
  settings: SettingsDto | null
  targets: DailyTargetDto[]
}

export type UpdatePreferencesDto = {
  settings: {
    cutoffTime: string
    soundsEnabled: boolean
    shortSessionMinutes: number
    longSessionMinutes: number
    breakSessionMinutes: number
    adaptiveEnabled?: boolean
  }
  targets: Array<{
    weekday: number
    targetMinutes: number
  }>
}

export type TimerRecommendationDto = {
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

export type CreateCourseDto = {
  name: string
}

export type UpdateCourseDto = {
  name: string
}

export type CreateActivityDto = {
  courseId: string
  name: string
  color: string
}

export type UpdateActivityDto = {
  name: string
  color: string
}

export type AchievementItemDto = {
  code: string
  title: string
  description: string
  icon: string
  earned: boolean
  earnedAt: string | null
  level: number | null
}

export type AchievementsResponseDto = {
  medals: {
    bronze: number
    silver: number
    gold: number
  }
  medalThresholds: {
    bronze: number
    silver: number
    gold: number
  }
  achievements: AchievementItemDto[]
}

export type StreakHeatmapDayDto = {
  date: string
  actualMinutes: number
  targetMinutes: number
  metTarget: boolean
  medal: 'none' | 'bronze' | 'silver' | 'gold'
}

export type StreakOverviewDto = {
  currentStreak: number
  longestStreak: number
  missedDays: number
  cutoffTime: string
  updatedAt: string
  heatmap: StreakHeatmapDayDto[]
}

export type ProductivityTrendDayDto = {
  date: string
  score: number
  actualMinutes: number
  targetMinutes: number
  sessionsCount: number
}

export type ProductivityOverviewDto = {
  todayScore: number
  weeklyAverage: number
  updatedAt: string
  explanation: {
    targetCompletion: number
    consistency: number
    sessionLength: number
    breaks: number
    summary: string
  }
  weeklyTrend: ProductivityTrendDayDto[]
}

export type AnalyticsInsightsDto = {
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
    level: 'low' | 'medium' | 'high'
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

export type AnalyticsPredictionDto = {
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

export type PlannerBlockStatus = 'upcoming' | 'completed' | 'missed'

export type PlannerBlockDto = {
  id: string
  courseId: string
  activityId: string | null
  startTime: string
  endTime: string
  note: string | null
  createdAt: string
  plannedMinutes: number
  actualMinutes: number
  status: PlannerBlockStatus
  course: CourseDto | null
  activity: ActivityDto | null
}

export type CreatePlannerBlockDto = {
  courseId: string
  activityId?: string | null
  startTime: string
  endTime: string
  note?: string
}

export type UpdatePlannerBlockDto = CreatePlannerBlockDto

export type PlannerOverviewDto = {
  plannedMinutes: number
  actualMinutes: number
  missedSessions: number
  varianceMinutes: number
}

export type DistractionType = 'phone' | 'social_media' | 'noise' | 'tiredness' | 'other'

export type DistractionDto = {
  id: string
  sessionId: string
  type: DistractionType
  label: string
  minutesLost: number
  note: string | null
  createdAt: string
}

export type CreateDistractionDto = {
  type: DistractionType
  minutesLost?: number
  note?: string
}

export type DistractionAnalyticsDto = {
  days: number
  totalMinutesLost: number
  totalEvents: number
  mostCommon: {
    type: DistractionType
    label: string
    count: number
    minutesLost: number
  } | null
  byType: Array<{
    type: DistractionType
    label: string
    count: number
    minutesLost: number
  }>
  suggestions: string[]
}
