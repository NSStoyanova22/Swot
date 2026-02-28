import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

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

export function TimerSessionProvider({ children }: { children: ReactNode }) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeTaskName, setActiveTaskName] = useState<string | null>(null)
  const [activeTaskDescription, setActiveTaskDescription] = useState<string | null>(null)
  const [activeTaskCourseId, setActiveTaskCourseId] = useState<string | null>(null)
  const [activeTaskCourseName, setActiveTaskCourseName] = useState<string | null>(null)
  const [activeTaskActivityId, setActiveTaskActivityId] = useState<string | null>(null)
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(null)
  const [sessionType, setSessionType] = useState<TimerSessionType>('pomodoro')

  const setActiveTask = useCallback(
    (task: ActiveTaskPayload, options?: { sessionType?: TimerSessionType; sessionStartTime?: string }) => {
      setActiveTaskId(task.id)
      setActiveTaskName(task.name)
      setActiveTaskDescription(task.description ?? null)
      setActiveTaskCourseId(task.courseId ?? null)
      setActiveTaskCourseName(task.courseName ?? null)
      setActiveTaskActivityId(task.activityId ?? null)
      setSessionType(options?.sessionType ?? 'pomodoro')
      setSessionStartTime(options?.sessionStartTime ?? new Date().toISOString())
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
  }, [])

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
      setSessionType,
      setSessionStartTime,
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
    ],
  )

  return <TimerSessionContext.Provider value={value}>{children}</TimerSessionContext.Provider>
}

export function useTimerSession() {
  const context = useContext(TimerSessionContext)
  if (!context) throw new Error('useTimerSession must be used within TimerSessionProvider')
  return context
}
