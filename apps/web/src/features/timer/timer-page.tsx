import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Coffee, Flame, Info, Maximize2, Minimize2, Pause, Play, RotateCcw, Save, Timer } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreateSessionDto } from '@/api/dtos'
import { getMe } from '@/api/me'
import { updateOrganizationTask } from '@/api/organization'
import { createSession } from '@/api/sessions'
import { getStreakOverview } from '@/api/streak'
import { getTimerRecommendation } from '@/api/timer'
import { getProductivityOverview } from '@/api/productivity'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FocusSoundsPanel } from '@/features/timer/focus-sounds-panel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarkdownNoteEditor } from '@/components/ui/markdown-note-editor'
import { useFullscreen } from '@/hooks/use-fullscreen'
import { useTimerSession } from '@/hooks/use-timer-session'
import { cn } from '@/lib/utils'
import { canTriggerCelebrationCooldown, markCelebrationCooldown } from '@/features/celebration/celebration-cooldown'
import { notifyCelebration } from '@/features/celebration/celebration-events'

type PomodoroMode = 'focus' | 'short' | 'long'
type TimerKind = 'focus' | 'manual'
type SessionOutcome = 'completed' | 'continue' | 'break'

const modeTheme = {
  focus: {
    label: 'Focus',
    aura: 'from-rose-200/80 via-pink-200/55 to-transparent',
    ringFrom: '#fb7185',
    ringTo: '#e11d77',
  },
  short: {
    label: 'Short Break',
    aura: 'from-cyan-200/70 via-sky-200/45 to-transparent',
    ringFrom: '#38bdf8',
    ringTo: '#0ea5e9',
  },
  long: {
    label: 'Long Break',
    aura: 'from-violet-200/70 via-indigo-200/45 to-transparent',
    ringFrom: '#a78bfa',
    ringTo: '#6366f1',
  },
} as const

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function playEndSound() {
  const audioContext = new window.AudioContext()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.value = 920
  gain.gain.value = 0.08

  oscillator.connect(gain)
  gain.connect(audioContext.destination)

  oscillator.start()
  oscillator.stop(audioContext.currentTime + 0.25)

  oscillator.onended = () => {
    void audioContext.close()
  }
}

function CircularTimer({
  mode,
  running,
  progress,
  time,
  label,
  clockClassName,
  containerClassName,
}: {
  mode: PomodoroMode
  running: boolean
  progress: number
  time: string
  label?: string
  clockClassName?: string
  containerClassName?: string
}) {
  const size = 316
  const stroke = 16
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const dashOffset = circumference * (1 - clampedProgress)

  return (
    <div className={cn('relative mx-auto w-full max-w-[360px]', containerClassName)}>
      <motion.div
        animate={{ opacity: running ? 1 : 0.8, scale: running ? 1 : 0.985 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'pointer-events-none absolute inset-7 rounded-full blur-2xl',
          mode === 'focus' && 'bg-rose-300/35',
          mode === 'short' && 'bg-cyan-300/30',
          mode === 'long' && 'bg-indigo-300/30',
        )}
      />

      <svg viewBox={`0 0 ${size} ${size}`} className="relative h-full w-full -rotate-90">
        <defs>
          <linearGradient id="timer-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={modeTheme[mode].ringFrom} />
            <stop offset="100%" stopColor={modeTheme[mode].ringTo} />
          </linearGradient>
        </defs>

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          className="fill-transparent stroke-muted/55"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="fill-transparent"
          stroke="url(#timer-progress-gradient)"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: dashOffset }}
          initial={false}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${mode}-${time}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label ?? modeTheme[mode].label}</p>
            <p className={cn('mt-1 text-5xl font-semibold tracking-tight md:text-6xl lg:text-7xl', clockClassName)}>{time}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

type LogSessionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  startTime: string
  endTime: string
  activeTask: {
    id: string
    name: string
    description: string | null
    courseId: string | null
    activityId: string | null
    courseName: string | null
  } | null
  requireOutcomeSelection: boolean
  onSessionSaved?: (outcome: SessionOutcome | null) => void
}

function LogSessionModal({
  open,
  onOpenChange,
  title,
  description,
  startTime,
  endTime,
  activeTask,
  requireOutcomeSelection,
  onSessionSaved,
}: LogSessionModalProps) {
  const queryClient = useQueryClient()
  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: ({ signal }) => getCourses(signal),
  })
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: ({ signal }) => getActivities(signal),
  })

  const courses = coursesQuery.data ?? []
  const activities = activitiesQuery.data ?? []

  const [courseId, setCourseId] = useState('')
  const [activityId, setActivityId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SessionOutcome | null>(null)

  useEffect(() => {
    if (open && courses.length > 0) {
      const preferredCourseId = activeTask?.courseId
      const hasPreferredCourse = preferredCourseId ? courses.some((course) => course.id === preferredCourseId) : false
      setCourseId((current) => {
        if (current) return current
        if (hasPreferredCourse && preferredCourseId) return preferredCourseId
        return courses[0].id
      })
    }
  }, [activeTask?.courseId, courses, open])

  useEffect(() => {
    if (!open) return
    if (!activeTask?.activityId) return
    setActivityId((current) => current || activeTask.activityId || '')
  }, [activeTask?.activityId, open])

  useEffect(() => {
    if (!open) {
      setActivityId('')
      setNote('')
      setError(null)
      setOutcome(null)
    }
  }, [open])

  const filteredActivities = useMemo(
    () => activities.filter((item) => item.courseId === courseId),
    [activities, courseId],
  )

  const mutation = useMutation({
    mutationFn: (payload: CreateSessionDto) => createSession(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['productivity'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-insights'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-prediction'] })
      queryClient.invalidateQueries({ queryKey: ['timer-recommendation'] })
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['org-unified'] })
      onSessionSaved?.(outcome)
      onOpenChange(false)
    },
    onError: () => {
      setError('Could not save session. Try again.')
    },
  })

  const canSave = courseId.length > 0 && (!requireOutcomeSelection || Boolean(outcome))

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!courseId) {
      setError('Select a course first.')
      return
    }
    if (requireOutcomeSelection && !outcome) {
      setError('Choose an outcome first.')
      return
    }

    mutation.mutate({
      courseId,
      activityId: activityId || undefined,
      taskId: activeTask?.id,
      startTime,
      endTime,
      breakMinutes: 0,
      note: note.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          {requireOutcomeSelection ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-sm font-medium">Did you finish the task?</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={outcome === 'completed' ? 'default' : 'outline'}
                  onClick={() => {
                    setOutcome('completed')
                    setError(null)
                  }}
                >
                  Task completed
                </Button>
                <Button
                  type="button"
                  variant={outcome === 'continue' ? 'default' : 'outline'}
                  onClick={() => {
                    setOutcome('continue')
                    setError(null)
                  }}
                >
                  Continue working
                </Button>
                <Button
                  type="button"
                  variant={outcome === 'break' ? 'default' : 'outline'}
                  onClick={() => {
                    setOutcome('break')
                    setError(null)
                  }}
                >
                  Take break
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Course</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm"
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value)
                  setActivityId('')
                }}
                required
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-sm font-medium">Activity</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm"
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
                disabled={filteredActivities.length === 0}
              >
                <option value="">No activity</option>
                {filteredActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm">
              <p className="text-muted-foreground">Start</p>
              <p className="font-medium">{new Date(startTime).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm">
              <p className="text-muted-foreground">End</p>
              <p className="font-medium">{new Date(endTime).toLocaleString()}</p>
            </div>
          </div>

          <MarkdownNoteEditor
            label="Note (Markdown)"
            value={note}
            onChange={setNote}
            placeholder="What did you work on? Supports Markdown."
          />

          {activeTask ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
              <p className="font-semibold">Linked task: {activeTask.name}</p>
              {activeTask.courseName ? <p className="text-muted-foreground">Course: {activeTask.courseName}</p> : null}
              {activeTask.description ? <p className="mt-1 text-muted-foreground">{activeTask.description}</p> : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Skip
            </Button>
            <Button type="submit" disabled={!canSave || mutation.isPending}>
              <Save className="h-4 w-4" />
              {mutation.isPending ? 'Saving...' : 'Save session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TimerPage({ startFocusSignal = 0 }: { startFocusSignal?: number }) {
  const queryClient = useQueryClient()
  const fullscreen = useFullscreen()
  const timerSession = useTimerSession()
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
  })
  const recommendationQuery = useQuery({
    queryKey: ['timer-recommendation'],
    queryFn: ({ signal }) => getTimerRecommendation(signal),
  })
  const streakQuery = useQuery({
    queryKey: ['streak'],
    queryFn: ({ signal }) => getStreakOverview(signal),
  })

  const settings = meQuery.data?.settings
  const recommendation = recommendationQuery.data
  const celebrationSettings = {
    enabled: settings?.celebrationEnabled ?? true,
    threshold: settings?.celebrationScoreThreshold ?? 90,
    cooldownHours: settings?.celebrationCooldownHours ?? 24,
    showFor: settings?.celebrationShowFor ?? 'all',
  }

  const baseFocusMinutes = Math.max(1, settings?.shortSessionMinutes ?? 25)
  const adaptiveFocusMinutes =
    recommendation && recommendation.adaptiveEnabled && recommendation.canAdapt
      ? recommendation.recommendedFocusMinutes
      : baseFocusMinutes

  const [focusOverrideEnabled, setFocusOverrideEnabled] = useState(false)
  const [focusOverrideMinutes, setFocusOverrideMinutes] = useState('')
  const [showWhy, setShowWhy] = useState(false)

  const effectiveFocusMinutes = useMemo(() => {
    if (!focusOverrideEnabled) return adaptiveFocusMinutes
    const parsed = Number(focusOverrideMinutes)
    if (!Number.isFinite(parsed) || parsed <= 0) return adaptiveFocusMinutes
    return Math.max(5, Math.min(180, Math.round(parsed)))
  }, [adaptiveFocusMinutes, focusOverrideEnabled, focusOverrideMinutes])

  const hasRecommendationExplanation = Boolean(
    recommendation &&
      recommendation.explanation &&
      recommendation.signals &&
      Number.isFinite(recommendation.baseFocusMinutes) &&
      Number.isFinite(recommendation.appliedDeltaMinutes),
  )
  const fallbackWhyText =
    'Adaptive recommendation details are temporarily unavailable. Using base focus minutes until more signal data is available.'

  const modeDurations = useMemo(
    () => ({
      focus: effectiveFocusMinutes,
      short: Math.max(1, settings?.breakSessionMinutes ?? 5),
      long: Math.max(1, settings?.longSessionMinutes ?? 50),
    }),
    [effectiveFocusMinutes, settings?.breakSessionMinutes, settings?.longSessionMinutes],
  )

  const [mode, setMode] = useState<PomodoroMode>('focus')
  const [remainingSeconds, setRemainingSeconds] = useState(modeDurations.focus * 60)
  const [pomodoroRunning, setPomodoroRunning] = useState(false)

  const [manualRunning, setManualRunning] = useState(false)
  const [manualElapsedSeconds, setManualElapsedSeconds] = useState(0)
  const [manualStartedAt, setManualStartedAt] = useState<string | null>(null)
  const [focusSessionsCompleted, setFocusSessionsCompleted] = useState(0)
  const [fullscreenTimerKind, setFullscreenTimerKind] = useState<TimerKind>('focus')
  const [showTaskCelebration, setShowTaskCelebration] = useState(false)

  const [logModal, setLogModal] = useState<{ kind: TimerKind; startTime: string; endTime: string } | null>(null)

  const canTriggerTimerCelebration = (scope: string, score: number) => {
    if (!celebrationSettings.enabled) return false
    if (celebrationSettings.showFor !== 'all') return false
    if (!Number.isFinite(score) || score < celebrationSettings.threshold) return false
    return canTriggerCelebrationCooldown(scope, celebrationSettings.cooldownHours)
  }

  const activeTask = timerSession.activeTaskId
    ? {
        id: timerSession.activeTaskId,
        name: timerSession.activeTaskName ?? 'Untitled task',
        description: timerSession.activeTaskDescription,
        courseId: timerSession.activeTaskCourseId,
        activityId: timerSession.activeTaskActivityId,
        courseName: timerSession.activeTaskCourseName,
      }
    : null

  const modeSeconds = modeDurations[mode] * 60

  useEffect(() => {
    if (!showTaskCelebration) return
    const timeout = window.setTimeout(() => setShowTaskCelebration(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [showTaskCelebration])

  useEffect(() => {
    setPomodoroRunning(false)
    setRemainingSeconds(modeSeconds)
  }, [mode, modeSeconds])

  useEffect(() => {
    if (!pomodoroRunning) return

    const interval = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(interval)
          return 0
        }

        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [pomodoroRunning])

  useEffect(() => {
    if (remainingSeconds !== 0 || !pomodoroRunning) return

    setPomodoroRunning(false)

    if (settings?.soundsEnabled ?? true) {
      playEndSound()
    }

    if (mode === 'focus') {
      const end = new Date()
      const start = new Date(end.getTime() - modeSeconds * 1000)
      setFocusSessionsCompleted((current) => current + 1)
      setLogModal({ kind: 'focus', startTime: start.toISOString(), endTime: end.toISOString() })
    }
  }, [mode, modeSeconds, pomodoroRunning, remainingSeconds, settings?.soundsEnabled, timerSession])

  useEffect(() => {
    if (!manualRunning) return

    const interval = window.setInterval(() => {
      setManualElapsedSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [manualRunning])

  const startPomodoro = () => {
    timerSession.setSessionType('pomodoro')
    if (timerSession.activeTaskId && !timerSession.sessionStartTime) {
      timerSession.setSessionStartTime(new Date().toISOString())
    }
    setPomodoroRunning(true)
  }

  useEffect(() => {
    if (startFocusSignal <= 0) return
    setMode('focus')
    timerSession.setSessionType('pomodoro')
    if (timerSession.activeTaskId && !timerSession.sessionStartTime) {
      timerSession.setSessionStartTime(new Date().toISOString())
    }
    setPomodoroRunning(true)
  }, [startFocusSignal, timerSession])

  useEffect(() => {
    if (focusOverrideEnabled) return
    setFocusOverrideMinutes(String(adaptiveFocusMinutes))
  }, [adaptiveFocusMinutes, focusOverrideEnabled])

  useEffect(() => {
    if (!showWhy) return
    if (hasRecommendationExplanation) return
    if (!import.meta.env.DEV) return
    console.warn('[timer] Adaptive recommendation explanation data is missing or incomplete', recommendation)
  }, [hasRecommendationExplanation, recommendation, showWhy])

  const resetPomodoro = () => {
    setPomodoroRunning(false)
    setRemainingSeconds(modeSeconds)
  }

  const startManual = () => {
    timerSession.setSessionType('manual')
    if (timerSession.activeTaskId && !timerSession.sessionStartTime) {
      timerSession.setSessionStartTime(new Date().toISOString())
    }
    if (!manualStartedAt) {
      setManualStartedAt(new Date().toISOString())
    }

    setManualRunning(true)
  }

  const resetManual = () => {
    setManualRunning(false)
    setManualElapsedSeconds(0)
    setManualStartedAt(null)
  }

  const finishManualAndLog = () => {
    if (!manualStartedAt || manualElapsedSeconds === 0) return

    const start = new Date(manualStartedAt)
    const end = new Date(start.getTime() + manualElapsedSeconds * 1000)
    setManualRunning(false)
    setLogModal({ kind: 'manual', startTime: start.toISOString(), endTime: end.toISOString() })
  }

  const enterFocusFullscreen = () => {
    setFullscreenTimerKind('focus')
    void fullscreen.enter()
  }

  const enterManualFullscreen = () => {
    setFullscreenTimerKind('manual')
    void fullscreen.enter()
  }

  const toggleFullscreen = () => {
    if (!fullscreen.isFullscreen) {
      setFullscreenTimerKind(manualRunning ? 'manual' : 'focus')
    }
    void fullscreen.toggle()
  }

  const onTaskLinkedSessionSaved = async (outcome: SessionOutcome | null) => {
    if (!outcome) return

    if (outcome === 'completed' && activeTask?.id) {
      try {
        await updateOrganizationTask(activeTask.id, { status: 'done', progress: 100 })
      } catch {
        // Session was saved; task status update can be retried later from Planner.
      }
      timerSession.clearActiveTask()
      setShowTaskCelebration(true)
      return
    }

    if (outcome === 'continue') {
      setMode('focus')
      setRemainingSeconds(modeDurations.focus * 60)
      setPomodoroRunning(true)
      return
    }

    if (outcome === 'break') {
      setMode('short')
      setPomodoroRunning(true)
    }
  }

  const onSessionCelebration = async (kind: TimerKind) => {
    if (kind !== 'focus') return
    const productivity = await queryClient.fetchQuery({
      queryKey: ['productivity'],
      queryFn: ({ signal }) => getProductivityOverview(signal),
    })
    const streak = await queryClient.fetchQuery({
      queryKey: ['streak'],
      queryFn: ({ signal }) => getStreakOverview(signal),
    })

    const productivityScore = productivity.todayScore
    if (canTriggerTimerCelebration('timer:session-completed', productivityScore)) {
      notifyCelebration({
        type: 'sessionCompleted',
        courseId: activeTask?.courseId ?? 'focus-session',
        courseName: activeTask?.name ?? 'Focus session',
        score: productivityScore,
        message: `${Math.round(productivityScore)}+ productivity score. Session logged.`,
      })
      markCelebrationCooldown('timer:session-completed')
    }

    const streakValue = streak.currentStreak ?? 0
    const milestoneReached = [3, 7, 14, 30, 60, 100].includes(streakValue)
    if (milestoneReached && canTriggerTimerCelebration(`timer:streak-${streakValue}`, productivityScore)) {
      notifyCelebration({
        type: 'streakMilestone',
        courseId: activeTask?.courseId ?? 'streak',
        courseName: 'Study streak',
        score: productivityScore,
        message: `Streak milestone reached: ${streakValue} days.`,
      })
      markCelebrationCooldown(`timer:streak-${streakValue}`)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      if (isTypingTarget) return

      if (event.code === 'Space') {
        event.preventDefault()
        if (pomodoroRunning) {
          setPomodoroRunning(false)
        } else {
          startPomodoro()
        }
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        resetPomodoro()
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        if (manualRunning) {
          setManualRunning(false)
        } else {
          startManual()
        }
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        toggleFullscreen()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [manualRunning, pomodoroRunning, startPomodoro, toggleFullscreen])

  const modeProgress = modeSeconds > 0 ? (modeSeconds - remainingSeconds) / modeSeconds : 0
  const manualProgress = Math.min(1, manualElapsedSeconds / Math.max(1, modeDurations.focus * 60))
  const streak = streakQuery.data?.currentStreak ?? 0
  const lifetimeSessions = recommendation?.sessionCount ?? 0
  const isFocusFullscreen = fullscreenTimerKind === 'focus'
  const fullscreenProgress = isFocusFullscreen ? modeProgress : manualProgress
  const fullscreenTime = isFocusFullscreen ? formatClock(remainingSeconds) : formatClock(manualElapsedSeconds)
  const fullscreenRunning = isFocusFullscreen ? pomodoroRunning : manualRunning
  const fullscreenSessionLabel = activeTask?.name ?? (isFocusFullscreen ? modeTheme[mode].label : 'Manual Study Session')
  const fullscreenTaskLabel = activeTask
    ? `${activeTask.courseName ? `Course: ${activeTask.courseName}` : 'Task-linked session'}`
    : isFocusFullscreen
      ? 'Linked task: attach when logging this session'
      : 'Linked task: add one when saving'

  return (
    <section className="relative mx-auto w-full max-w-6xl px-1 sm:px-2">
      <motion.div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br blur-2xl',
          modeTheme[mode].aura,
        )}
        animate={{ opacity: pomodoroRunning ? 0.95 : 0.65 }}
        transition={{ duration: 0.45 }}
      />

      <AnimatePresence>
        {showTaskCelebration ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-3 rounded-xl border border-emerald-300/40 bg-emerald-100/60 px-4 py-2 text-sm font-medium text-emerald-900"
          >
            Task completed. Nice work.
          </motion.div>
        ) : null}
      </AnimatePresence>

      {activeTask ? (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Working on</p>
              <p className="truncate text-lg font-semibold">{activeTask.name}</p>
              {activeTask.description ? <p className="mt-1 text-sm text-muted-foreground">{activeTask.description}</p> : null}
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {activeTask.courseName ? <span>Course: {activeTask.courseName}</span> : null}
                {timerSession.sessionStartTime ? (
                  <span>Started: {new Date(timerSession.sessionStartTime).toLocaleTimeString()}</span>
                ) : null}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={timerSession.clearActiveTask}>
              Clear task
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid w-full gap-4 md:gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
        <div className="min-w-0">
          <Card
            className={cn(
              'w-full border-white/30 bg-card/55 backdrop-blur-xl shadow-soft',
              pomodoroRunning && 'shadow-[0_0_45px_rgba(236,72,153,0.25)]',
            )}
          >
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-2xl md:text-3xl">🍅 Immersive Pomodoro</CardTitle>
                  <CardDescription>Premium focus experience with adaptive timing and smooth transitions.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border/70 bg-background/65 px-3 py-1 text-xs text-muted-foreground">
                    Total sessions: {lifetimeSessions}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/65 px-3 py-1 text-xs text-muted-foreground">
                    <Flame className="h-3.5 w-3.5 text-primary" />
                    Streak: {streak}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  { value: 'focus', label: 'Focus', icon: Timer },
                  { value: 'short', label: 'Short Break', icon: Coffee },
                  { value: 'long', label: 'Long Break', icon: Clock3 },
                ] as const).map((item) => (
                  <motion.div key={item.value} whileTap={{ scale: 0.98 }}>
                    <Button
                      variant={mode === item.value ? 'default' : 'outline'}
                      className={cn('h-11 w-full gap-2 text-sm', mode === item.value && 'shadow-soft')}
                      onClick={() => setMode(item.value)}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  </motion.div>
                ))}
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="rounded-2xl border border-border/70 bg-background/45 p-4 sm:p-6">
                <CircularTimer
                  mode={mode}
                  running={pomodoroRunning}
                  progress={modeProgress}
                  time={formatClock(remainingSeconds)}
                />
                <div className="mt-4 space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      animate={{ width: `${Math.max(0, Math.min(100, modeProgress * 100))}%` }}
                      transition={{ duration: 0.45, ease: 'easeInOut' }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{Math.round(Math.max(0, Math.min(100, modeProgress * 100)))}% complete</span>
                    <span>Duration {modeDurations[mode]} min</span>
                    <span>Focus blocks this run: {focusSessionsCompleted}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <motion.div whileTap={{ scale: 0.97 }}>
                  {!pomodoroRunning ? (
                    <Button onClick={startPomodoro} className="min-w-28 gap-2">
                      <Play className="h-4 w-4" />
                      Start
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setPomodoroRunning(false)} className="min-w-28 gap-2">
                      <Pause className="h-4 w-4" />
                      Pause
                    </Button>
                  )}
                </motion.div>
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button variant="outline" onClick={resetPomodoro} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                </motion.div>
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button variant="outline" onClick={enterFocusFullscreen} className="gap-2">
                    <Maximize2 className="h-4 w-4" />
                    Fullscreen
                  </Button>
                </motion.div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">Space: Start/Pause</span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">R: Reset</span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">M: Manual timer</span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">F: Fullscreen</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 md:space-y-5">
          <Card className="w-full border-white/30 bg-card/55 backdrop-blur-xl shadow-soft">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock3 className="h-4 w-4 text-primary" />
                ⏱️ Manual Study Session
              </CardTitle>
              <CardDescription>Track real time and save as a session whenever you finish.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/65 p-5 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Elapsed</p>
                <p className="mt-2 text-4xl font-semibold tracking-tight">{formatClock(manualElapsedSeconds)}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-primary/80"
                    animate={{ width: `${Math.round(manualProgress * 100)}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {manualStartedAt
                    ? `Started at ${new Date(manualStartedAt).toLocaleTimeString()}`
                    : 'Press start to begin tracking'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {!manualRunning ? (
                  <Button onClick={startManual} className="gap-2">
                    <Play className="h-4 w-4" />
                    Start
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setManualRunning(false)} className="gap-2">
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                )}
                <Button variant="outline" onClick={resetManual} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                <Button
                  variant="default"
                  onClick={finishManualAndLog}
                  disabled={!manualStartedAt || manualElapsedSeconds === 0}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  Save
                </Button>
                <Button variant="outline" onClick={enterManualFullscreen} className="gap-2">
                  <Maximize2 className="h-4 w-4" />
                  Fullscreen
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="w-full border-white/30 bg-card/55 backdrop-blur-xl shadow-soft">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4 text-primary" />
                Adaptive Recommendation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border/70 bg-background/65 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">🧠 Adaptive focus recommendation</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowWhy(true)}
                    aria-expanded={showWhy}
                    aria-controls="adaptive-why-panel"
                  >
                    <Info className="h-3.5 w-3.5" />
                    Why this?
                  </button>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Recommended: <span className="font-semibold text-foreground">{adaptiveFocusMinutes} min</span>
                  {recommendation
                    ? ` · Base ${recommendation.baseFocusMinutes} min · Delta ${recommendation.appliedDeltaMinutes >= 0 ? '+' : ''}${recommendation.appliedDeltaMinutes} min`
                    : ''}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm"
                    onClick={() => setFocusOverrideEnabled((current) => !current)}
                  >
                    {focusOverrideEnabled ? 'Use adaptive value' : 'Override manually'}
                  </button>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                    value={focusOverrideMinutes}
                    onChange={(event) => setFocusOverrideMinutes(event.target.value)}
                    disabled={!focusOverrideEnabled}
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="w-full min-w-0">
            <FocusSoundsPanel />
          </div>
        </div>
      </div>

      {fullscreen.isFullscreen ? (
        <div
          className={cn(
            'fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-background/95 px-4 py-6',
            fullscreen.isFallbackFullscreen && 'timer-fullscreen-fallback',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Timer fullscreen focus mode"
        >
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.03, 1] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="absolute left-1/2 top-1/2 h-[62vh] w-[62vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
          </motion.div>

          <div className="relative flex w-full max-w-5xl flex-col items-center gap-5 text-center">
            <div className="flex w-full items-start justify-between gap-3">
              <div className="text-left">
                <p className="text-base font-semibold">{fullscreenSessionLabel}</p>
                <p className="text-xs text-muted-foreground">{fullscreenTaskLabel}</p>
              </div>
              <Button variant="outline" className="gap-2" onClick={() => void fullscreen.exit()}>
                <Minimize2 className="h-4 w-4" />
                Exit Fullscreen
              </Button>
            </div>

            <CircularTimer
              mode={isFocusFullscreen ? mode : 'focus'}
              running={fullscreenRunning}
              progress={fullscreenProgress}
              time={fullscreenTime}
              label={isFocusFullscreen ? modeTheme[mode].label : 'Elapsed'}
              containerClassName="max-w-[540px]"
              clockClassName="text-[clamp(5rem,12vw,7.5rem)] leading-none"
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              {isFocusFullscreen ? (
                <>
                  {!pomodoroRunning ? (
                    <Button onClick={startPomodoro} className="min-w-28 gap-2">
                      <Play className="h-4 w-4" />
                      Start
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setPomodoroRunning(false)} className="min-w-28 gap-2">
                      <Pause className="h-4 w-4" />
                      Pause
                    </Button>
                  )}
                  <Button variant="outline" onClick={resetPomodoro} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                </>
              ) : (
                <>
                  {!manualRunning ? (
                    <Button onClick={startManual} className="gap-2">
                      <Play className="h-4 w-4" />
                      Start
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setManualRunning(false)} className="gap-2">
                      <Pause className="h-4 w-4" />
                      Pause
                    </Button>
                  )}
                  <Button variant="outline" onClick={resetManual} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Reset
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={showWhy} onOpenChange={setShowWhy}>
        <DialogContent id="adaptive-why-panel" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Why this recommendation?</DialogTitle>
            <DialogDescription>
              Adaptive focus duration is based on your recent timer outcomes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 rounded-lg border border-border/70 bg-background/70 p-3 sm:grid-cols-3">
              <p>
                Recommended:{' '}
                <span className="font-semibold text-foreground">{adaptiveFocusMinutes} min</span>
              </p>
              <p>
                Base:{' '}
                <span className="font-semibold text-foreground">{recommendation?.baseFocusMinutes ?? baseFocusMinutes} min</span>
              </p>
              <p>
                Delta:{' '}
                <span className="font-semibold text-foreground">
                  {recommendation ? `${recommendation.appliedDeltaMinutes >= 0 ? '+' : ''}${recommendation.appliedDeltaMinutes}` : '+0'} min
                </span>
              </p>
            </div>

            {hasRecommendationExplanation && recommendation ? (
              <>
                <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">Explanation</p>
                  <p className="text-muted-foreground">{recommendation.explanation}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/70 p-3">
                  <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Contributing Signals</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>Recent completion rate: {Math.round(recommendation.signals.completionRatio * 100)}%</li>
                    <li>Consistency score: {Math.round(recommendation.signals.consistencyScore * 100)}%</li>
                    <li>Break compliance: {Math.round((1 - recommendation.signals.breakHeavyRatio) * 100)}%</li>
                    <li>Early cancel ratio: {Math.round(recommendation.signals.earlyCancelRatio * 100)}%</li>
                    <li>Recent sessions considered: {recommendation.signals.recentSessions}</li>
                    <li>Baseline sessions considered: {recommendation.signals.previousSessions}</li>
                    <li>Current streak context: {streak} day{streak === 1 ? '' : 's'}</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-amber-300/40 bg-amber-100/40 p-3 text-muted-foreground">
                <p>{fallbackWhyText}</p>
                <p className="mt-1 text-xs">If this persists, save a few sessions and refresh recommendations.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowWhy(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {logModal ? (
        <LogSessionModal
          open={Boolean(logModal)}
          onOpenChange={(open) => {
            if (!open) {
              if (logModal.kind === 'manual') {
                setManualElapsedSeconds(0)
                setManualStartedAt(null)
              }
              if (logModal.kind === 'focus') {
                setRemainingSeconds(modeSeconds)
              }
              setLogModal(null)
            }
          }}
          title={logModal.kind === 'focus' ? 'Focus block complete' : 'Save study session'}
          description={
            logModal.kind === 'focus'
              ? 'Great work. Add context and save this completed focus block as a session.'
              : 'Attach this real-time study timer to a course and optional activity.'
          }
          startTime={logModal.startTime}
          endTime={logModal.endTime}
          activeTask={activeTask}
          requireOutcomeSelection={Boolean(activeTask && logModal.kind === 'focus')}
          onSessionSaved={(outcome) => {
            void onTaskLinkedSessionSaved(outcome)
            void onSessionCelebration(logModal.kind)
          }}
        />
      ) : null}
    </section>
  )
}
