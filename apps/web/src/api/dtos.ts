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
  }
  targets: Array<{
    weekday: number
    targetMinutes: number
  }>
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
