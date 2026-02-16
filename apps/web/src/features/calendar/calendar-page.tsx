import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Save } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreateSessionDto, PlannerBlockDto, SessionDto } from '@/api/dtos'
import { getPlannerBlocks } from '@/api/planner'
import { createSession, getSessions, updateSession } from '@/api/sessions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MarkdownNoteEditor } from '@/components/ui/markdown-note-editor'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type SessionEditorState = {
  date: string
  startTime: string
  endTime: string
  breakMinutes: string
  courseId: string
  activityId: string
  note: string
}

type EditorModalState =
  | {
      mode: 'create'
      selectedDate: Date
      session?: undefined
    }
  | {
      mode: 'edit'
      selectedDate: Date
      session: SessionDto
    }

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function toLocalDateInput(date: Date) {
  return toDateKey(date)
}

function toLocalTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function buildInitialForm(modalState: EditorModalState, defaultCourseId: string): SessionEditorState {
  if (modalState.mode === 'edit') {
    const start = new Date(modalState.session.startTime)
    const end = new Date(modalState.session.endTime)

    return {
      date: toLocalDateInput(start),
      startTime: toLocalTimeInput(start),
      endTime: toLocalTimeInput(end),
      breakMinutes: String(modalState.session.breakMinutes),
      courseId: modalState.session.courseId,
      activityId: modalState.session.activityId ?? '',
      note: modalState.session.note ?? '',
    }
  }

  return {
    date: toLocalDateInput(modalState.selectedDate),
    startTime: '09:00',
    endTime: '10:00',
    breakMinutes: '0',
    courseId: defaultCourseId,
    activityId: '',
    note: '',
  }
}

function SessionEditorDialog({
  open,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  state: EditorModalState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
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

  const defaultCourseId = courses[0]?.id ?? ''
  const [form, setForm] = useState<SessionEditorState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !state) return
    setForm(buildInitialForm(state, defaultCourseId))
    setError(null)
  }, [defaultCourseId, open, state])

  const filteredActivities = useMemo(() => {
    if (!form) return []
    return activities.filter((activity) => activity.courseId === form.courseId)
  }, [activities, form])

  const createMutation = useMutation({
    mutationFn: createSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['productivity'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-insights'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-prediction'] })
      queryClient.invalidateQueries({ queryKey: ['timer-recommendation'] })
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      onSaved()
    },
    onError: () => setError('Could not save session.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateSessionDto }) => updateSession(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['productivity'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-insights'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-prediction'] })
      queryClient.invalidateQueries({ queryKey: ['timer-recommendation'] })
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      onSaved()
    },
    onError: () => setError('Could not update session.'),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form || !state) return

    const breakMinutes = Number(form.breakMinutes || 0)
    if (!form.courseId) {
      setError('Please choose a course.')
      return
    }

    if (Number.isNaN(breakMinutes) || breakMinutes < 0) {
      setError('Break minutes must be 0 or greater.')
      return
    }

    const startTime = new Date(`${form.date}T${form.startTime}:00`)
    const endTime = new Date(`${form.date}T${form.endTime}:00`)

    if (endTime.getTime() <= startTime.getTime()) {
      setError('End time must be after start time.')
      return
    }

    const payload: CreateSessionDto = {
      courseId: form.courseId,
      activityId: form.activityId || undefined,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      breakMinutes,
      note: form.note.trim() || undefined,
    }

    if (state.mode === 'create') {
      createMutation.mutate(payload)
    } else {
      updateMutation.mutate({ id: state.session.id, payload })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit Session' : 'Add Session'}</DialogTitle>
          <DialogDescription>
            {state?.mode === 'edit'
              ? 'Update details for this study block.'
              : 'Log a study session for the selected date.'}
          </DialogDescription>
        </DialogHeader>

        {form ? (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Date</span>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((current) => (current ? { ...current, date: event.target.value } : current))}
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Start</span>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, startTime: event.target.value } : current))
                  }
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">End</span>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(event) => setForm((current) => (current ? { ...current, endTime: event.target.value } : current))}
                  required
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Break (min)</span>
                <Input
                  type="number"
                  min={0}
                  value={form.breakMinutes}
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, breakMinutes: event.target.value } : current))
                  }
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium">Course</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm"
                  value={form.courseId}
                  onChange={(event) =>
                    setForm((current) =>
                      current ? { ...current, courseId: event.target.value, activityId: '' } : current,
                    )
                  }
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
                  value={form.activityId}
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, activityId: event.target.value } : current))
                  }
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

            <MarkdownNoteEditor
              label="Note (Markdown)"
              value={form.note}
              onChange={(value) => setForm((current) => (current ? { ...current, note: value } : current))}
              placeholder="Optional notes. Supports Markdown."
            />

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                <Save className="h-4 w-4" />
                {state?.mode === 'edit' ? 'Update session' : 'Save session'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState(() => toDateKey(new Date()))
  const [editorState, setEditorState] = useState<EditorModalState | null>(null)
  const monthFrom = startOfMonth(currentMonth)
  const monthTo = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => getSessions({}, signal),
  })
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: ({ signal }) => getActivities(signal),
  })
  const plannerQuery = useQuery({
    queryKey: ['planner-blocks', 'calendar-month', monthFrom.toISOString(), monthTo.toISOString()],
    queryFn: ({ signal }) => getPlannerBlocks({ from: monthFrom.toISOString(), to: monthTo.toISOString() }, signal),
  })

  const sessions = sessionsQuery.data ?? []
  const activities = activitiesQuery.data ?? []
  const plannerBlocks = plannerQuery.data ?? []

  const fallbackColorByCourse = useMemo(() => {
    const map = new Map<string, string>()
    activities.forEach((activity) => {
      if (!map.has(activity.courseId)) {
        map.set(activity.courseId, activity.color)
      }
    })
    return map
  }, [activities])

  const monthMeta = useMemo(() => {
    const monthStartDate = startOfMonth(currentMonth)
    const mondayOffset = (monthStartDate.getDay() + 6) % 7
    const gridStart = addDays(monthStartDate, -mondayOffset)

    const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))

    const dayTotals = new Map<string, number>()
    const dayColors = new Map<string, string[]>()
    const plannedTotals = new Map<string, number>()
    const plannedColors = new Map<string, string[]>()

    sessions.forEach((session) => {
      const startedAt = new Date(session.startTime)
      const key = toDateKey(startedAt)
      dayTotals.set(key, (dayTotals.get(key) ?? 0) + session.durationMinutes)

      const color = session.activity?.color ?? fallbackColorByCourse.get(session.courseId) ?? '#ec4899'
      const current = dayColors.get(key) ?? []
      if (!current.includes(color)) {
        dayColors.set(key, [...current, color])
      }
    })

    plannerBlocks.forEach((block) => {
      const start = new Date(block.startTime)
      const key = toDateKey(start)
      plannedTotals.set(key, (plannedTotals.get(key) ?? 0) + block.plannedMinutes)

      const color = block.activity?.color ?? fallbackColorByCourse.get(block.courseId) ?? '#ec4899'
      const current = plannedColors.get(key) ?? []
      if (!current.includes(color)) {
        plannedColors.set(key, [...current, color])
      }
    })

    return { days, dayTotals, dayColors, plannedTotals, plannedColors }
  }, [currentMonth, fallbackColorByCourse, plannerBlocks, sessions])

  const selectedDate = parseDateKey(selectedDayKey)
  const selectedSessions = useMemo(() => {
    return sessions
      .filter((session) => toDateKey(new Date(session.startTime)) === selectedDayKey)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [selectedDayKey, sessions])

  const selectedPlannedBlocks = useMemo(() => {
    return plannerBlocks
      .filter((block) => toDateKey(new Date(block.startTime)) === selectedDayKey)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [plannerBlocks, selectedDayKey])

  if (sessionsQuery.isPending || plannerQuery.isPending) {
    return (
      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
      <Card className="shadow-soft">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                Calendar
              </CardTitle>
              <CardDescription>Monthly overview with daily totals and study color dots.</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setCurrentMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Badge className="min-w-36 justify-center">
                {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </Badge>
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setCurrentMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {weekdayLabels.map((label) => (
              <p key={label}>{label}</p>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {monthMeta.days.map((date) => {
              const key = toDateKey(date)
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
              const isSelected = key === selectedDayKey
              const totalMinutes = monthMeta.dayTotals.get(key) ?? 0
              const plannedMinutes = monthMeta.plannedTotals.get(key) ?? 0
              const colors = monthMeta.dayColors.get(key) ?? []
              const planned = monthMeta.plannedColors.get(key) ?? []

              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'min-h-24 rounded-lg border border-border/70 bg-background/80 p-2 text-left transition-colors',
                    isCurrentMonth ? 'opacity-100' : 'opacity-45',
                    isSelected && 'border-primary/60 bg-primary/5',
                  )}
                  onClick={() => setSelectedDayKey(key)}
                >
                  <p className="text-sm font-medium">{date.getDate()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totalMinutes > 0 ? formatMinutes(totalMinutes) : 'No sessions'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/85">
                    {plannedMinutes > 0 ? `Planned: ${formatMinutes(plannedMinutes)}` : 'No plan'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {colors.slice(0, 5).map((color) => (
                      <span
                        key={`${key}-${color}`}
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    {colors.length > 5 ? <span className="text-[10px] text-muted-foreground">+{colors.length - 5}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {planned.slice(0, 4).map((color) => (
                      <span
                        key={`${key}-planned-${color}`}
                        className="h-2.5 w-2.5 rounded-full border"
                        style={{ borderColor: color, backgroundColor: 'transparent' }}
                      />
                    ))}
                    {planned.length > 4 ? (
                      <span className="text-[10px] text-muted-foreground">+{planned.length - 4}</span>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {selectedDate.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </CardTitle>
              <CardDescription>
                {selectedSessions.length} actual session(s) · {selectedPlannedBlocks.length} planned block(s)
              </CardDescription>
            </div>
            <Button onClick={() => setEditorState({ mode: 'create', selectedDate })}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned blocks</p>
            {selectedPlannedBlocks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background/70 p-3 text-sm text-muted-foreground">
                No planned blocks for this day.
              </div>
            ) : (
              selectedPlannedBlocks.map((block: PlannerBlockDto) => (
                <div key={`planned-${block.id}`} className="rounded-lg border border-border/70 bg-background/75 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{block.course?.name ?? 'Course'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(block.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(block.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {formatMinutes(block.plannedMinutes)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(block.status === 'missed' && 'border-destructive/40 text-destructive')}
                    >
                      {block.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actual sessions</p>
          {selectedSessions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
              No sessions logged for this day yet.
            </div>
          ) : (
            selectedSessions.map((session) => (
              <div key={session.id} className="rounded-lg border border-border/70 bg-background/75 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{session.course.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' - '}
                      {new Date(session.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      {formatMinutes(session.durationMinutes)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditorState({ mode: 'edit', selectedDate, session })}
                  >
                    Edit
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {session.activity ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: session.activity.color }} />
                      {session.activity.name}
                    </span>
                  ) : null}
                  {session.note ? (
                    <MarkdownPreview value={session.note} className="text-xs text-muted-foreground" />
                  ) : null}
                </div>
              </div>
            ))
          )}
          </div>
        </CardContent>
      </Card>

      <SessionEditorDialog
        open={Boolean(editorState)}
        state={editorState}
        onOpenChange={(open) => {
          if (!open) setEditorState(null)
        }}
        onSaved={() => {
          setEditorState(null)
        }}
      />
    </section>
  )
}
