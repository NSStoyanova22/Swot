import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  clearTimerSessionState,
  readTimerSessionState,
  writeTimerSessionState,
  type TimerSessionPersistedState,
} from '@/lib/timer-storage'

export type TimerSessionType = 'pomodoro' | 'manual'

type ActiveTaskPayload = {
  id: string
  name: string
  description?: string | null
  courseId?: string | null
  courseName?: string | null
  activityId?: string | null
}

type TimerSessionContextValue = {
  activeTaskId: string | null
  activeTaskName: string | null
  activeTaskDescription: string | null
  activeTaskCourseId: string | null
  activeTaskCourseName: string | null
  activeTaskActivityId: string | null
  sessionStartTime: string | null
  sessionType: TimerSessionType
  setActiveTask: (task: ActiveTaskPayload, options?: { sessionType?: TimerSessionType; sessionStartTime?: string }) => void
  clearActiveTask: () => void
  setSessionType: (sessionType: TimerSessionType) => void
  setSessionStartTime: (sessionStartTime: string | null) => void
}

const TimerSessionContext = createContext<TimerSessionContextValue | null>(null)

function readPersistedSession(): TimerSessionPersistedState | null {
  return readTimerSessionState()
}

function persistSession(state: TimerSessionPersistedState) {
  writeTimerSessionState(state)
}

export function TimerSessionProvider({ children }: { children: ReactNode }) {
  const persisted = readPersistedSession()

  const [activeTaskId, setActiveTaskId] = useState<string | null>(persisted?.activeTaskId ?? null)
  const [activeTaskName, setActiveTaskName] = useState<string | null>(persisted?.activeTaskName ?? null)
  const [activeTaskDescription, setActiveTaskDescription] = useState<string | null>(persisted?.activeTaskDescription ?? null)
  const [activeTaskCourseId, setActiveTaskCourseId] = useState<string | null>(persisted?.activeTaskCourseId ?? null)
  const [activeTaskCourseName, setActiveTaskCourseName] = useState<string | null>(persisted?.activeTaskCourseName ?? null)
  const [activeTaskActivityId, setActiveTaskActivityId] = useState<string | null>(persisted?.activeTaskActivityId ?? null)
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(persisted?.sessionStartTime ?? null)
  const [sessionType, setSessionType] = useState<TimerSessionType>(persisted?.sessionType ?? 'pomodoro')

  const syncPersistedSession = useCallback(
    (overrides: Partial<TimerSessionPersistedState> = {}) => {
      persistSession({
        activeTaskId,
        activeTaskName,
        activeTaskDescription,
        activeTaskCourseId,
        activeTaskCourseName,
        activeTaskActivityId,
        sessionStartTime,
        sessionType,
        ...overrides,
      })
    },
    [
      activeTaskActivityId,
      activeTaskCourseId,
      activeTaskCourseName,
      activeTaskDescription,
      activeTaskId,
      activeTaskName,
      sessionStartTime,
      sessionType,
    ],
  )

  useEffect(() => {
    syncPersistedSession()
  }, [syncPersistedSession])

  const setActiveTask = useCallback(
    (task: ActiveTaskPayload, options?: { sessionType?: TimerSessionType; sessionStartTime?: string }) => {
      const nextSessionType = options?.sessionType ?? 'pomodoro'
      const nextSessionStartTime = options?.sessionStartTime ?? new Date().toISOString()
      setActiveTaskId(task.id)
      setActiveTaskName(task.name)
      setActiveTaskDescription(task.description ?? null)
      setActiveTaskCourseId(task.courseId ?? null)
      setActiveTaskCourseName(task.courseName ?? null)
      setActiveTaskActivityId(task.activityId ?? null)
      setSessionType(nextSessionType)
      setSessionStartTime(nextSessionStartTime)
      persistSession({
        activeTaskId: task.id,
        activeTaskName: task.name,
        activeTaskDescription: task.description ?? null,
        activeTaskCourseId: task.courseId ?? null,
        activeTaskCourseName: task.courseName ?? null,
        activeTaskActivityId: task.activityId ?? null,
        sessionStartTime: nextSessionStartTime,
        sessionType: nextSessionType,
      })
    },
    [],
  )

  const clearActiveTask = useCallback(() => {
    setActiveTaskId(null)
    setActiveTaskName(null)
    setActiveTaskDescription(null)
    setActiveTaskCourseId(null)
    setActiveTaskCourseName(null)
    setActiveTaskActivityId(null)
    setSessionStartTime(null)
    setSessionType('pomodoro')
    clearTimerSessionState()
  }, [])

  const setSessionTypePersisted = useCallback((nextSessionType: TimerSessionType) => {
    setSessionType(nextSessionType)
    persistSession({
      activeTaskId,
      activeTaskName,
      activeTaskDescription,
      activeTaskCourseId,
      activeTaskCourseName,
      activeTaskActivityId,
      sessionStartTime,
      sessionType: nextSessionType,
    })
  }, [
    activeTaskActivityId,
    activeTaskCourseId,
    activeTaskCourseName,
    activeTaskDescription,
    activeTaskId,
    activeTaskName,
    sessionStartTime,
  ])

  const setSessionStartTimePersisted = useCallback((nextSessionStartTime: string | null) => {
    setSessionStartTime(nextSessionStartTime)
    persistSession({
      activeTaskId,
      activeTaskName,
      activeTaskDescription,
      activeTaskCourseId,
      activeTaskCourseName,
      activeTaskActivityId,
      sessionStartTime: nextSessionStartTime,
      sessionType,
    })
  }, [
    activeTaskActivityId,
    activeTaskCourseId,
    activeTaskCourseName,
    activeTaskDescription,
    activeTaskId,
    activeTaskName,
    sessionType,
  ])

  const value = useMemo<TimerSessionContextValue>(
    () => ({
      activeTaskId,
      activeTaskName,
      activeTaskDescription,
      activeTaskCourseId,
      activeTaskCourseName,
      activeTaskActivityId,
      sessionStartTime,
      sessionType,
      setActiveTask,
      clearActiveTask,
      setSessionType: setSessionTypePersisted,
      setSessionStartTime: setSessionStartTimePersisted,
    }),
    [
      activeTaskActivityId,
      activeTaskCourseId,
      activeTaskCourseName,
      activeTaskDescription,
      activeTaskId,
      activeTaskName,
      clearActiveTask,
      sessionStartTime,
      sessionType,
      setActiveTask,
      setSessionStartTimePersisted,
      setSessionTypePersisted,
    ],
  )

  return <TimerSessionContext.Provider value={value}>{children}</TimerSessionContext.Provider>
}

export function useTimerSession() {
  const context = useContext(TimerSessionContext)
  if (!context) throw new Error('useTimerSession must be used within TimerSessionProvider')
  return context
}
