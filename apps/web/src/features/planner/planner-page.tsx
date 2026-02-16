import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus2, ChevronLeft, ChevronRight, Clock3, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreatePlannerBlockDto, PlannerBlockDto } from '@/api/dtos'
import {
  createPlannerBlock,
  deletePlannerBlock,
  getPlannerBlocks,
  getPlannerOverview,
  updatePlannerBlock,
} from '@/api/planner'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const plannerBlocksKey = ['planner-blocks'] as const
const plannerOverviewKey = ['planner-overview'] as const

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

type PlannerEditorState =
  | { mode: 'create'; selectedDate: Date; block?: undefined }
  | { mode: 'edit'; selectedDate: Date; block: PlannerBlockDto }

type PlannerFormState = {
  date: string
  startTime: string
  endTime: string
  courseId: string
  activityId: string
  note: string
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function getWeekStart(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  const offset = (normalized.getDay() + 6) % 7
  return addDays(normalized, -offset)
}

function toInputDate(date: Date) {
  return toDateKey(date)
}

function toInputTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatMinutes(minutes: number) {
  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(minutes)
  if (absolute < 60) return `${sign}${absolute}m`
  const hours = Math.floor(absolute / 60)
  const remaining = absolute % 60
  return remaining === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${remaining}m`
}

function buildForm(state: PlannerEditorState, defaultCourseId: string): PlannerFormState {
  if (state.mode === 'edit') {
    const start = new Date(state.block.startTime)
    const end = new Date(state.block.endTime)
    return {
      date: toInputDate(start),
      startTime: toInputTime(start),
      endTime: toInputTime(end),
      courseId: state.block.courseId,
      activityId: state.block.activityId ?? '',
      note: state.block.note ?? '',
    }
  }

  return {
    date: toInputDate(state.selectedDate),
    startTime: '16:00',
    endTime: '17:00',
    courseId: defaultCourseId,
    activityId: '',
    note: '',
  }
}

function PlannerEditorDialog({
  open,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  state: PlannerEditorState | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
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
  const [form, setForm] = useState<PlannerFormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !state) return
    setForm(buildForm(state, courses[0]?.id ?? ''))
    setError(null)
  }, [courses, open, state])

  const filteredActivities = useMemo(() => {
    if (!form) return []
    return activities.filter((activity) => activity.courseId === form.courseId)
  }, [activities, form])

  const createMutation = useMutation({
    mutationFn: createPlannerBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: plannerBlocksKey })
      queryClient.invalidateQueries({ queryKey: plannerOverviewKey })
      onSaved()
      toast({
        variant: 'success',
        title: 'Study block added',
        description: 'Your planned session was added to this week.',
      })
    },
    onError: () => setError('Could not create planned block.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreatePlannerBlockDto }) => updatePlannerBlock(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: plannerBlocksKey })
      queryClient.invalidateQueries({ queryKey: plannerOverviewKey })
      onSaved()
      toast({
        variant: 'success',
        title: 'Study block updated',
      })
    },
    onError: () => setError('Could not update planned block.'),
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form || !state) return

    if (!form.courseId) {
      setError('Please choose a course.')
      return
    }

    const start = new Date(`${form.date}T${form.startTime}:00`)
    const end = new Date(`${form.date}T${form.endTime}:00`)
    if (end.getTime() <= start.getTime()) {
      setError('End time must be after start time.')
      return
    }

    const payload: CreatePlannerBlockDto = {
      courseId: form.courseId,
      activityId: form.activityId || undefined,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: form.note.trim() || undefined,
    }

    if (state.mode === 'create') {
      createMutation.mutate(payload)
    } else {
      updateMutation.mutate({ id: state.block.id, payload })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === 'edit' ? 'Edit study block' : 'Schedule study block'}</DialogTitle>
          <DialogDescription>Plan upcoming sessions and compare them to your actual logs later.</DialogDescription>
        </DialogHeader>

        {form ? (
          <form className="mt-4 space-y-4" onSubmit={onSubmit}>
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
                  onChange={(event) =>
                    setForm((current) => (current ? { ...current, endTime: event.target.value } : current))
                  }
                  required
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
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

            <label className="space-y-1.5">
              <span className="text-sm font-medium">Note</span>
              <Textarea
                value={form.note}
                onChange={(event) => setForm((current) => (current ? { ...current, note: event.target.value } : current))}
                placeholder="Optional plan note"
              />
            </label>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {state?.mode === 'edit' ? 'Update block' : 'Add block'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function PlannerPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const [editorState, setEditorState] = useState<PlannerEditorState | null>(null)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekFrom = weekStart.toISOString()
  const weekTo = addDays(weekStart, 7).toISOString()

  const blocksQuery = useQuery({
    queryKey: [...plannerBlocksKey, weekFrom, weekTo],
    queryFn: ({ signal }) => getPlannerBlocks({ from: weekFrom, to: weekTo }, signal),
  })

  const overviewQuery = useQuery({
    queryKey: [...plannerOverviewKey, weekFrom, weekTo],
    queryFn: ({ signal }) => getPlannerOverview({ from: weekFrom, to: weekTo }, signal),
  })

  const deleteMutation = useMutation({
    mutationFn: deletePlannerBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: plannerBlocksKey })
      queryClient.invalidateQueries({ queryKey: plannerOverviewKey })
      toast({
        variant: 'success',
        title: 'Study block removed',
      })
    },
  })

  const dragMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreatePlannerBlockDto }) => updatePlannerBlock(id, payload),
    onMutate: async ({ id, payload }) => {
      const key = [...plannerBlocksKey, weekFrom, weekTo] as const
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<PlannerBlockDto[]>(key) ?? []
      queryClient.setQueryData<PlannerBlockDto[]>(key, (current = []) =>
        current.map((block) =>
          block.id === id
            ? {
                ...block,
                courseId: payload.courseId,
                activityId: payload.activityId ?? null,
                startTime: payload.startTime,
                endTime: payload.endTime,
                note: payload.note ?? null,
              }
            : block,
        ),
      )
      return { previous, key }
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.key, context.previous)
      }
      toast({
        variant: 'error',
        title: 'Move failed',
        description: 'Could not move block. Please try again.',
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: plannerBlocksKey })
      queryClient.invalidateQueries({ queryKey: plannerOverviewKey })
    },
  })

  const blocksByDay = useMemo(() => {
    const map = new Map<string, PlannerBlockDto[]>()
    const items = blocksQuery.data ?? []

    items.forEach((block) => {
      const key = toDateKey(new Date(block.startTime))
      const current = map.get(key) ?? []
      current.push(block)
      map.set(key, current)
    })

    for (const day of weekDays) {
      const key = toDateKey(day)
      const itemsForDay = map.get(key) ?? []
      itemsForDay.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      map.set(key, itemsForDay)
    }

    return map
  }, [blocksQuery.data, weekDays])

  const weekLabel = `${weekDays[0].toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${weekDays[6].toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`

  const handleDrop = (targetDate: Date) => {
    if (!draggingBlockId || !blocksQuery.data) return

    const block = blocksQuery.data.find((item) => item.id === draggingBlockId)
    if (!block) return

    const start = new Date(block.startTime)
    const end = new Date(block.endTime)
    const durationMs = end.getTime() - start.getTime()

    const movedStart = new Date(targetDate)
    movedStart.setHours(start.getHours(), start.getMinutes(), 0, 0)
    const movedEnd = new Date(movedStart.getTime() + durationMs)

    dragMutation.mutate({
      id: block.id,
      payload: {
        courseId: block.courseId,
        activityId: block.activityId ?? undefined,
        startTime: movedStart.toISOString(),
        endTime: movedEnd.toISOString(),
        note: block.note ?? undefined,
      },
    })
  }

  if (blocksQuery.isPending || overviewQuery.isPending) {
    return (
      <section className="space-y-4">
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-64" />
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-7">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-44 w-full" />
            ))}
          </CardContent>
        </Card>
      </section>
    )
  }

  const overview = overviewQuery.data ?? {
    plannedMinutes: 0,
    actualMinutes: 0,
    missedSessions: 0,
    varianceMinutes: 0,
  }

  return (
    <section className="space-y-4">
      <Card className="shadow-soft">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarPlus2 className="h-4 w-4 text-primary" />
                Study Planner
              </CardTitle>
              <CardDescription>Plan future study blocks, drag to adjust your week, and compare planned vs actual.</CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setWeekStart((current) => addDays(current, -7))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Badge className="min-w-44 justify-center">{weekLabel}</Badge>
              <Button variant="outline" size="icon" onClick={() => setWeekStart((current) => addDays(current, 7))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button onClick={() => setEditorState({ mode: 'create', selectedDate: weekDays[0] })}>
                <Plus className="h-4 w-4" />
                Add block
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-background/80 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Planned</p>
            <p className="mt-1 text-xl font-semibold">{formatMinutes(overview.plannedMinutes)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/80 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Actual</p>
            <p className="mt-1 text-xl font-semibold">{formatMinutes(overview.actualMinutes)}</p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/80 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Variance</p>
            <p className={cn('mt-1 text-xl font-semibold', overview.varianceMinutes < 0 ? 'text-destructive' : 'text-emerald-600')}>
              {overview.varianceMinutes > 0 ? '+' : ''}
              {formatMinutes(overview.varianceMinutes)}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/80 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Missed blocks</p>
            <p className="mt-1 text-xl font-semibold">{overview.missedSessions}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle>Weekly Schedule</CardTitle>
          <CardDescription>Drag any block to another day. Click a block to edit details.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-7">
          {weekDays.map((day, index) => {
            const key = toDateKey(day)
            const dayBlocks = blocksByDay.get(key) ?? []
            return (
              <div
                key={key}
                className="rounded-lg border border-border/70 bg-background/70 p-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(day)}
              >
                <div className="mb-2 rounded-md bg-primary/10 px-2 py-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">{weekdayLabels[index]}</p>
                  <p className="text-xs text-muted-foreground">{day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                </div>

                <div className="space-y-2">
                  {dayBlocks.length === 0 ? (
                    <button
                      type="button"
                      className="w-full rounded-md border border-dashed border-border bg-background/70 px-2 py-4 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      onClick={() => setEditorState({ mode: 'create', selectedDate: parseDateKey(key) })}
                    >
                      No plans yet
                    </button>
                  ) : (
                    dayBlocks.map((block) => (
                      <div
                        key={block.id}
                        className="group rounded-md border border-border/70 bg-card p-2 shadow-sm transition hover:border-primary/40 hover:shadow-soft"
                        draggable
                        onDragStart={() => setDraggingBlockId(block.id)}
                        onDragEnd={() => setDraggingBlockId(null)}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => setEditorState({ mode: 'edit', selectedDate: day, block })}
                          >
                            <p className="truncate text-xs font-semibold">{block.course?.name ?? 'Course'}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {new Date(block.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(block.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <div className="mt-1 flex items-center gap-1">
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                {formatMinutes(block.plannedMinutes)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 px-1.5 text-[10px]',
                                  block.status === 'missed' && 'border-destructive/40 text-destructive',
                                )}
                              >
                                {block.status}
                              </Badge>
                            </div>
                          </button>
                          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>

                        <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditorState({ mode: 'edit', selectedDate: day, block })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(block.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="h-4 w-4 text-primary" />
            Planned vs actual
          </CardTitle>
          <CardDescription>
            Planned minutes are from scheduled blocks. Actual minutes are matched from logged sessions in overlapping windows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.plannedMinutes === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
              Start by adding your first planned block for this week. Missed sessions and variance will appear automatically.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">Completion ratio</p>
                <p className="text-lg font-semibold">
                  {Math.round((overview.actualMinutes / Math.max(1, overview.plannedMinutes)) * 100)}%
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">Missed tracking</p>
                <p className="text-lg font-semibold">{overview.missedSessions} missed</p>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">Schedule health</p>
                <p className="text-lg font-semibold">
                  {overview.varianceMinutes >= 0 ? 'On pace' : 'Behind plan'}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PlannerEditorDialog
        open={Boolean(editorState)}
        state={editorState}
        onOpenChange={(open) => {
          if (!open) setEditorState(null)
        }}
        onSaved={() => setEditorState(null)}
      />
    </section>
  )
}
