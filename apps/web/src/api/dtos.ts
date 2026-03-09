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
  taskId?: string | null
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
  riskEnabled?: boolean
  riskThresholdMode?: 'score' | 'grade'
  riskScoreThreshold?: number
  riskGradeThresholdByScale?: {
    bulgarian?: number
    german?: number
    percentage?: number
  }
  riskLookback?: 'currentTerm' | 'previousTerm' | 'academicYear'
  riskMinDataPoints?: number
  riskUseTermFinalIfAvailable?: boolean
  riskShowOnlyIfBelowThreshold?: boolean
  celebrationEnabled?: boolean
  celebrationScoreThreshold?: number
  celebrationCooldownHours?: number
  celebrationShowFor?: 'gradeItem' | 'termFinal' | 'courseAverage' | 'all'
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
  uiPreferences: UiPreferencesDto
  ignoredShkoloSubjects?: string[]
}

export type UiPreferencesDto = {
  workspaceName: string
  avatar: string
  accentColor: string
  dashboardBackground: string
  themePreset: 'system' | 'soft-rose' | 'midnight' | 'ocean-calm' | 'forest-focus' | 'minimal-light' | 'violet-studio' | 'pink' | 'purple' | 'dark' | 'minimal'
  widgetStyle: 'soft' | 'glass' | 'flat'
  layoutDensity: 'comfortable' | 'compact' | 'cozy'
}

export type UpdatePreferencesDto = {
  settings: {
    cutoffTime: string
    soundsEnabled: boolean
    shortSessionMinutes: number
    longSessionMinutes: number
    breakSessionMinutes: number
    adaptiveEnabled?: boolean
    riskEnabled?: boolean
    riskThresholdMode?: 'score' | 'grade'
    riskScoreThreshold?: number
    riskGradeThresholdByScale?: {
      bulgarian?: number
      german?: number
      percentage?: number
    }
    riskLookback?: 'currentTerm' | 'previousTerm' | 'academicYear'
    riskMinDataPoints?: number
    riskUseTermFinalIfAvailable?: boolean
    riskShowOnlyIfBelowThreshold?: boolean
    celebrationEnabled?: boolean
    celebrationScoreThreshold?: number
    celebrationCooldownHours?: number
    celebrationShowFor?: 'gradeItem' | 'termFinal' | 'courseAverage' | 'all'
  }
  targets: Array<{
    weekday: number
    targetMinutes: number
  }>
  uiPreferences?: Partial<UiPreferencesDto>
  ignoredShkoloSubjects?: string[]
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

export type GradeScale = 'percentage' | 'german' | 'bulgarian'

export type TermDto = {
  id: string
  userId: string
  schoolYear: string
  name: string
  position: number
  startDate: string | null
  endDate: string | null
  createdAt: string
  updatedAt: string
}

export type CreateTermDto = {
  schoolYear: string
  name: string
  position?: number
  startDate?: string | null
  endDate?: string | null
}

export type UpdateTermDto = Partial<CreateTermDto>

export type GradeItemDto = {
  id: string
  userId: string
  termId: string
  courseId: string
  categoryId?: string | null
  scale: GradeScale
  gradeValue: number
  performanceScore: number
  weight: number
  isFinal?: boolean
  finalType?: 'TERM1' | 'TERM2' | 'YEAR' | null
  gradedOn: string
  note: string | null
  importMetadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  term?: {
    id: string
    schoolYear: string
    name: string
    position: number
  }
  course?: {
    id: string
    name: string
  }
  category?: {
    id: string
    name: string
    weight: number
    dropLowest: boolean
  } | null
}

export type CreateGradeItemDto = {
  termId: string
  courseId: string
  categoryId?: string | null
  scale: GradeScale
  gradeValue: number
  weight?: number
  isFinal?: boolean
  finalType?: 'TERM1' | 'TERM2' | 'YEAR' | null
  gradedOn: string
  note?: string
  importMetadata?: Record<string, unknown> | null
}

export type UpdateGradeItemDto = Partial<CreateGradeItemDto> & {
  note?: string | null
}

export type BulkGradeImportDto = {
  termId: string
  scale: GradeScale
  gradedOn?: string
  items: Array<{
    courseId: string
    categoryId?: string | null
    gradeValue: number
    weight?: number
    note?: string
    isFinal?: boolean
    finalType?: 'TERM1' | 'TERM2' | 'YEAR' | null
    importMetadata?: Record<string, unknown> | null
  }>
}

export type GradeCategoryDto = {
  id: string
  userId: string
  courseId: string
  name: string
  weight: number
  dropLowest: boolean
  createdAt?: string
  updatedAt?: string
}

export type CreateGradeCategoryDto = {
  courseId: string
  name: string
  weight: number
  dropLowest?: boolean
}

export type UpdateGradeCategoryDto = Partial<Pick<CreateGradeCategoryDto, 'name' | 'weight' | 'dropLowest'>>

export type GradesWhatIfResultDto = {
  currentAverage: number | null
  resultingAverage: number | null
  delta: number | null
  categoryAverages: Array<{
    categoryId: string
    name: string
    weight: number
    dropLowest: boolean
    currentAverage: number | null
    resultingAverage: number | null
  }>
}

export type BulkGradeImportResultDto = {
  count: number
  itemIds: string[]
}

export type GradePhotoImportItemDto = {
  courseName: string
  gradeValue: number
  confidence: number
}

export type GradePhotoImportResultDto = {
  source: 'mock' | 'ocr'
  fileName: string
  items: GradePhotoImportItemDto[]
}

export type OcrTextResponseDto = {
  fileName: string
  mimeType: string
  text: string
}

export type ShkoloRowDto = {
  extractedSubject: string
  currentGrades: number[]
  term1: number | null
  term2: number | null
  t1CurrentGrades?: number[]
  t2CurrentGrades?: number[]
  t1FinalGrade?: number | null
  t2FinalGrade?: number | null
  yearFinalGrade?: number | null
  rawRowText?: string
  parseWarnings?: string[]
}

export type ShkoloPdfImportResultDto = {
  fileName: string
  detectedYear: string | null
  rows: ShkoloRowDto[]
  skippedLines: number
  parseWarnings?: string[]
  debug?: {
    rawSamples: string[]
    pagesText?: Array<{
      page: number
      text: string
    }>
    pageItems?: Record<string, Array<{
      page: number
      str: string
      x: number
      y: number
      width: number
      height: number
    }>>
    usedOcrFallback: boolean
    scannedThreshold: number
    totalExtractedLength: number
    extractedPageTextLengths: Array<{
      page: number
      length: number
    }>
    ocrPageTextLengths: Array<{
      page: number
      general: number
      digits: number
      total: number
    }>
    ignoredShkoloSubjects?: string[]
    filteredOutCount?: number
  }
}

export type GradeCourseSummaryDto = {
  courseId: string
  courseName: string
  averageValue: number
  averageScore: number
  averageNormalizedScore: number | null
  itemCount: number
}

export type GradeCourseTrendDto = GradeCourseSummaryDto & {
  previousAverageValue: number | null
  previousAverageScore: number | null
  previousAverageNormalizedScore: number | null
  delta: number | null
}

export type GradesSummaryDto = {
  termId: string | null
  termName?: string
  schoolYear?: string
  displayScale: GradeScale
  includeTermGrade: boolean
  method: string
  overallAverage: number | null
  overallAverageNormalized: number | null
  previousTermAverage: number | null
  previousTermAverageNormalized: number | null
  deltaFromPrevious: number | null
  bestCourses: GradeCourseSummaryDto[]
  worstCourses: GradeCourseSummaryDto[]
  courseTrends: GradeCourseTrendDto[]
}

export type CourseGradeTargetDto = {
  id?: string
  userId: string
  courseId: string
  courseName?: string
  targetScore: number
  scale: GradeScale
  targetValue: number
  createdAt?: string
  updatedAt?: string
}

export type StudyRecommendationDto = {
  courseId: string
  courseName: string
  displayScale: GradeScale
  gradeBand: 'atRisk' | 'watch' | 'good' | 'excellent'
  averageValue: number | null
  averageNormalized: number | null
  attentionScore: number
  recommendedMinutes: number
  reasons: string[]
}

export type AcademicRiskLevel = 'low' | 'medium' | 'high'

export type AcademicRiskDto = {
  courseId: string
  courseName: string
  riskScore: number
  riskLevel: AcademicRiskLevel
  gradeBand: 'atRisk' | 'watch' | 'good' | 'excellent'
  displayScale: GradeScale
  reasons: string[]
  suggestedActions: string[]
  recommendedMinutes: number
  studyMinutes14d: number
  upcomingDeadlines: number
  upcomingExams: number
  currentAverage: number | null
  currentAverageNormalized: number | null
  deltaFromPrevious: number | null
}

export type CelebrationStateDto = {
  settings: {
    celebrationEnabled: boolean
    celebrationScoreThreshold: number
    celebrationCooldownHours: number
    celebrationShowFor: 'gradeItem' | 'termFinal' | 'courseAverage' | 'all'
  }
  records: Array<{
    courseId: string
    lastCelebratedAt: string
    lastCelebratedScore: number | null
    lastCelebratedType: string | null
  }>
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

export type PlannerAutoAddDto = {
  courseId: string
  totalMinutes: number
  weekStartDate: string
}

export type PlannerAutoAddResultDto = {
  blockIds: string[]
  blocksCount: number
  dayLabels: string[]
}

export type PlannerOverviewDto = {
  plannedMinutes: number
  actualMinutes: number
  missedSessions: number
  varianceMinutes: number
}

export type OrganizationTaskStatus = 'todo' | 'in_progress' | 'done'
export type OrganizationTaskKind = 'task' | 'exam'
export type OrganizationPriority = 'low' | 'medium' | 'high'

export type OrganizationSubtaskDto = {
  id: string
  title: string
  done: boolean
  sortOrder: number
}

export type OrganizationTaskDto = {
  id: string
  title: string
  description: string | null
  kind: string
  status: string
  progress: number
  priority: string
  dueAt: string | null
  courseId: string | null
  activityId: string | null
  timeSpentMinutes: number
  createdAt: string
  updatedAt: string
  subtasks: OrganizationSubtaskDto[]
  subtaskStats: {
    total: number
    completed: number
  }
}

export type CreateOrganizationTaskDto = {
  title: string
  description?: string
  kind?: OrganizationTaskKind
  status?: OrganizationTaskStatus
  progress?: number
  priority?: OrganizationPriority
  dueAt?: string | null
  courseId?: string | null
  activityId?: string | null
  timeSpentMinutes?: number
  subtasks?: Array<{ title: string }>
}

export type UpdateOrganizationTaskDto = Partial<CreateOrganizationTaskDto>

export type OrganizationReminderDto = {
  id: string
  taskId: string | null
  scheduleBlockId: string | null
  title: string
  remindAt: string
  repeatRule: 'none' | 'daily' | 'weekly' | string
  nextTriggerAt: string | null
  delivered: boolean
  lastTriggeredAt: string | null
  createdAt: string
  updatedAt: string
}

export type CreateOrganizationReminderDto = {
  taskId?: string | null
  scheduleBlockId?: string | null
  title: string
  remindAt: string
  repeatRule?: 'none' | 'daily' | 'weekly'
}

export type OrganizationScheduleBlockDto = {
  id: string
  title: string
  note: string | null
  courseId: string | null
  activityId: string | null
  dayOfWeek: number
  startTime: string
  endTime: string
  rotationIntervalDays: number | null
  rotationOffset: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CreateOrganizationScheduleBlockDto = {
  title: string
  note?: string
  courseId?: string | null
  activityId?: string | null
  dayOfWeek: number
  startTime: string
  endTime: string
  rotationIntervalDays?: number | null
  rotationOffset?: number
  isActive?: boolean
}

export type OrganizationUnifiedItemDto = {
  id: string
  type: 'planned' | 'session' | 'task' | 'reminder' | 'schedule'
  title: string
  startTime: string
  endTime: string | null
  tone: 'default' | 'success' | 'warning' | 'danger'
  meta: string
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
