import type { ElapsedTimerSnapshot } from '@/lib/elapsed-timer'

const POMODORO_STORAGE_KEY = 'swot-pomodoro-timer-v1'
const MANUAL_STORAGE_KEY = 'swot-manual-timer-v1'
const TIMER_SESSION_STORAGE_KEY = 'swot-timer-session-v1'

export type PomodoroMode = 'focus' | 'short' | 'long'

export type PomodoroPersistedState = ElapsedTimerSnapshot & {
  mode: PomodoroMode
  focusSessionsCompleted: number
}

export type ManualPersistedState = ElapsedTimerSnapshot

export type TimerSessionPersistedState = {
  activeTaskId: string | null
  activeTaskName: string | null
  activeTaskDescription: string | null
  activeTaskCourseId: string | null
  activeTaskCourseName: string | null
  activeTaskActivityId: string | null
  sessionStartTime: string | null
  sessionType: 'pomodoro' | 'manual'
}

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function removeKey(key: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

export function readPomodoroState(): PomodoroPersistedState | null {
  return readJson<PomodoroPersistedState>(POMODORO_STORAGE_KEY)
}

export function writePomodoroState(state: PomodoroPersistedState) {
  writeJson(POMODORO_STORAGE_KEY, state)
}

export function clearPomodoroState() {
  removeKey(POMODORO_STORAGE_KEY)
}

export function readManualTimerState(): ManualPersistedState | null {
  return readJson<ManualPersistedState>(MANUAL_STORAGE_KEY)
}

export function writeManualTimerState(state: ManualPersistedState) {
  writeJson(MANUAL_STORAGE_KEY, state)
}

export function clearManualTimerState() {
  removeKey(MANUAL_STORAGE_KEY)
}

export function readTimerSessionState(): TimerSessionPersistedState | null {
  return readJson<TimerSessionPersistedState>(TIMER_SESSION_STORAGE_KEY)
}

export function writeTimerSessionState(state: TimerSessionPersistedState) {
  writeJson(TIMER_SESSION_STORAGE_KEY, state)
}

export function clearTimerSessionState() {
  removeKey(TIMER_SESSION_STORAGE_KEY)
}
