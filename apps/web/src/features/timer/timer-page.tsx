import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Coffee, Pause, Play, RotateCcw, Save, Timer, Zap } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreateSessionDto } from '@/api/dtos'
import { getMe } from '@/api/me'
import { createSession } from '@/api/sessions'
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

  const settings = meQuery.data?.settings

  const modeDurations = useMemo(
    () => ({
      focus: Math.max(1, settings?.shortSessionMinutes ?? 25),
      short: Math.max(1, settings?.breakSessionMinutes ?? 5),
      long: Math.max(1, settings?.longSessionMinutes ?? 50),
    }),
    [settings?.breakSessionMinutes, settings?.longSessionMinutes, settings?.shortSessionMinutes],
  )

  const [mode, setMode] = useState<PomodoroMode>('focus')
  const [remainingSeconds, setRemainingSeconds] = useState(modeDurations.focus * 60)
  const [pomodoroRunning, setPomodoroRunning] = useState(false)

  const [manualRunning, setManualRunning] = useState(false)
  const [manualElapsedSeconds, setManualElapsedSeconds] = useState(0)
  const [manualStartedAt, setManualStartedAt] = useState<string | null>(null)

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

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Pomodoro Timer
          </CardTitle>
          <CardDescription>Focus, short break, and long break modes powered by Settings durations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {([
              { value: 'focus', label: 'Focus', icon: Timer },
              { value: 'short', label: 'Short break', icon: Coffee },
              { value: 'long', label: 'Long break', icon: Clock3 },
            ] as const).map((item) => (
              <Button
                key={item.value}
                variant={mode === item.value ? 'default' : 'outline'}
                className={cn('gap-1.5', mode === item.value && 'shadow-soft')}
                onClick={() => setMode(item.value)}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 p-6 text-center">
            <p className="text-sm text-muted-foreground">{mode.charAt(0).toUpperCase() + mode.slice(1)} remaining</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight">{formatClock(remainingSeconds)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Duration: {modeDurations[mode]} min from Settings {settings?.soundsEnabled ? '(sound on)' : '(sound off)'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!pomodoroRunning ? (
              <Button onClick={startPomodoro}>
                <Play className="h-4 w-4" />
                Start
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setPomodoroRunning(false)}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}

            <Button variant="outline" onClick={resetPomodoro}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            Start a Study Session
          </CardTitle>
          <CardDescription>Track real time manually and save when you finish.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border/70 bg-background/70 p-6 text-center">
            <p className="text-sm text-muted-foreground">Elapsed</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight">{formatClock(manualElapsedSeconds)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {manualStartedAt
                ? `Started at ${new Date(manualStartedAt).toLocaleTimeString()}`
                : 'Press start to begin tracking'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!manualRunning ? (
              <Button onClick={startManual}>
                <Play className="h-4 w-4" />
                Start
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setManualRunning(false)}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            <Button variant="outline" onClick={resetManual}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button
              variant="default"
              onClick={finishManualAndLog}
              disabled={!manualStartedAt || manualElapsedSeconds === 0}
            >
              <Save className="h-4 w-4" />
              Save as session
            </Button>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            After a focus timer ends or manual session finishes, you can choose course/activity and save it to Sessions.
          </div>
        </CardContent>
      </Card>

      <FocusSoundsPanel />

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
