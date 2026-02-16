import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Coffee, Flame, Info, Pause, Play, RotateCcw, Save, Timer } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreateSessionDto } from '@/api/dtos'
import { getMe } from '@/api/me'
import { createSession } from '@/api/sessions'
import { getStreakOverview } from '@/api/streak'
import { getTimerRecommendation } from '@/api/timer'
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
import { cn } from '@/lib/utils'

type PomodoroMode = 'focus' | 'short' | 'long'
type TimerKind = 'focus' | 'manual'

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
}: {
  mode: PomodoroMode
  running: boolean
  progress: number
  time: string
}) {
  const size = 316
  const stroke = 16
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clampedProgress = Math.max(0, Math.min(1, progress))
  const dashOffset = circumference * (1 - clampedProgress)

  return (
    <div className="relative mx-auto w-full max-w-[360px]">
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
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{modeTheme[mode].label}</p>
            <p className="mt-1 text-5xl font-semibold tracking-tight md:text-6xl lg:text-7xl">{time}</p>
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
}

function LogSessionModal({
  open,
  onOpenChange,
  title,
  description,
  startTime,
  endTime,
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

  useEffect(() => {
    if (open && courses.length > 0) {
      setCourseId((current) => current || courses[0].id)
    }
  }, [courses, open])

  useEffect(() => {
    if (!open) {
      setActivityId('')
      setNote('')
      setError(null)
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
      onOpenChange(false)
    },
    onError: () => {
      setError('Could not save session. Try again.')
    },
  })

  const canSave = courseId.length > 0

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canSave) {
      setError('Select a course first.')
      return
    }

    mutation.mutate({
      courseId,
      activityId: activityId || undefined,
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

  const baseFocusMinutes = Math.max(1, settings?.shortSessionMinutes ?? 25)
  const adaptiveFocusMinutes =
    recommendation && recommendation.adaptiveEnabled && recommendation.canAdapt
      ? recommendation.recommendedFocusMinutes
      : baseFocusMinutes

  const [focusOverrideEnabled, setFocusOverrideEnabled] = useState(false)
  const [focusOverrideMinutes, setFocusOverrideMinutes] = useState('')

  const effectiveFocusMinutes = useMemo(() => {
    if (!focusOverrideEnabled) return adaptiveFocusMinutes
    const parsed = Number(focusOverrideMinutes)
    if (!Number.isFinite(parsed) || parsed <= 0) return adaptiveFocusMinutes
    return Math.max(5, Math.min(180, Math.round(parsed)))
  }, [adaptiveFocusMinutes, focusOverrideEnabled, focusOverrideMinutes])

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

  const [logModal, setLogModal] = useState<{ kind: TimerKind; startTime: string; endTime: string } | null>(null)

  const modeSeconds = modeDurations[mode] * 60

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
  }, [mode, modeSeconds, pomodoroRunning, remainingSeconds, settings?.soundsEnabled])

  useEffect(() => {
    if (!manualRunning) return

    const interval = window.setInterval(() => {
      setManualElapsedSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [manualRunning])

  const startPomodoro = () => {
    setPomodoroRunning(true)
  }

  useEffect(() => {
    if (startFocusSignal <= 0) return
    setMode('focus')
    setPomodoroRunning(true)
  }, [startFocusSignal])

  useEffect(() => {
    if (focusOverrideEnabled) return
    setFocusOverrideMinutes(String(adaptiveFocusMinutes))
  }, [adaptiveFocusMinutes, focusOverrideEnabled])

  const resetPomodoro = () => {
    setPomodoroRunning(false)
    setRemainingSeconds(modeSeconds)
  }

  const startManual = () => {
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
        setPomodoroRunning((current) => !current)
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
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [manualRunning, modeSeconds])

  const modeProgress = modeSeconds > 0 ? (modeSeconds - remainingSeconds) / modeSeconds : 0
  const manualProgress = Math.min(1, manualElapsedSeconds / Math.max(1, modeDurations.focus * 60))
  const streak = streakQuery.data?.currentStreak ?? 0
  const lifetimeSessions = recommendation?.sessionCount ?? 0

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
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">Space: Start/Pause</span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">R: Reset</span>
                <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1">M: Manual timer</span>
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
                  <span
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                    title={recommendation?.explanation ?? 'No recommendation yet'}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Why this?
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Recommended: <span className="font-semibold text-foreground">{adaptiveFocusMinutes} min</span>
                  {recommendation
                    ? ` · Base ${recommendation.baseFocusMinutes} min · Delta ${recommendation.appliedDeltaMinutes >= 0 ? '+' : ''}${recommendation.appliedDeltaMinutes} min`
                    : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {recommendation?.adaptiveEnabled
                    ? recommendation?.canAdapt
                      ? recommendation.explanation
                      : 'Adaptive mode is on, but more sessions are needed before adjustment starts.'
                    : 'Adaptive mode is off. Enable it in Settings to auto-adjust focus length.'}
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
        />
      ) : null}
    </section>
  )
}
