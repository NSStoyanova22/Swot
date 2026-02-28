import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus2, ChevronLeft, ChevronRight, GripVertical, Pencil, Play, Plus, Trash2 } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { CreatePlannerBlockDto, OrganizationTaskDto, PlannerBlockDto } from '@/api/dtos'
import {
  createOrganizationScheduleBlock,
  createOrganizationTask,
  deleteOrganizationTask,
  getOrganizationReminders,
  getOrganizationScheduleBlocks,
  getOrganizationTasks,
  updateOrganizationTask,
} from '@/api/organization'
import {
  createPlannerBlock,
  deletePlannerBlock,
  getPlannerBlocks,
  getPlannerOverview,
  updatePlannerBlock,
} from '@/api/planner'
import { PageContainer, PageHeader } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useTimerSession } from '@/hooks/use-timer-session'
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

type TaskComposerState = {
  title: string
  dueAt: string
  priority: 'low' | 'medium' | 'high'
  courseId: string
}

type ScheduleComposerState = {
  title: string
  dayOfWeek: number
  startTime: string
  endTime: string
  rotationIntervalDays: string
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

export function PlannerPage({ onStartFocusTask }: { onStartFocusTask?: () => void } = {}) {
  const timerSession = useTimerSession()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'tasks' | 'schedule' | 'reminders'>('tasks')
  const [taskComposerOpen, setTaskComposerOpen] = useState(false)
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const [editorState, setEditorState] = useState<PlannerEditorState | null>(null)
  const [taskComposer, setTaskComposer] = useState<TaskComposerState>({
    title: '',
    dueAt: '',
    priority: 'medium',
    courseId: '',
  })
  const [scheduleComposer, setScheduleComposer] = useState<ScheduleComposerState>({
    title: '',
    dayOfWeek: 1,
    startTime: '16:00',
    endTime: '17:00',
    rotationIntervalDays: '',
  })

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekFrom = weekStart.toISOString()
  const weekTo = addDays(weekStart, 7).toISOString()
  const timelineTo = addDays(weekStart, 14).toISOString()

  const blocksQuery = useQuery({
    queryKey: [...plannerBlocksKey, weekFrom, weekTo],
    queryFn: ({ signal }) => getPlannerBlocks({ from: weekFrom, to: weekTo }, signal),
  })

  const overviewQuery = useQuery({
    queryKey: [...plannerOverviewKey, weekFrom, weekTo],
    queryFn: ({ signal }) => getPlannerOverview({ from: weekFrom, to: weekTo }, signal),
  })
  const tasksQuery = useQuery({
    queryKey: ['org-tasks', weekFrom, timelineTo],
    queryFn: ({ signal }) => getOrganizationTasks({ from: weekFrom, to: timelineTo }, signal),
  })
  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: ({ signal }) => getCourses(signal),
  })
  const scheduleBlocksQuery = useQuery({
    queryKey: ['org-schedule-blocks'],
    queryFn: ({ signal }) => getOrganizationScheduleBlocks(signal),
  })
  const remindersQuery = useQuery({
    queryKey: ['org-reminders'],
    queryFn: ({ signal }) => getOrganizationReminders(signal),
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

  const createTaskMutation = useMutation({
    mutationFn: createOrganizationTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['org-unified'] })
      setTaskComposer({
        title: '',
        dueAt: '',
        priority: 'medium',
        courseId: '',
      })
      toast({ variant: 'success', title: 'Task added' })
    },
    onError: () => toast({ variant: 'error', title: 'Could not add task' }),
  })

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateOrganizationTask>[1] }) =>
      updateOrganizationTask(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['org-unified'] })
    },
  })

  const deleteTaskMutation = useMutation({
    mutationFn: deleteOrganizationTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['org-unified'] })
      toast({ variant: 'success', title: 'Task deleted' })
    },
    onError: () => toast({ variant: 'error', title: 'Could not delete task' }),
  })

  const createScheduleBlockMutation = useMutation({
    mutationFn: createOrganizationScheduleBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-schedule-blocks'] })
      setScheduleComposer({
        title: '',
        dayOfWeek: 1,
        startTime: '16:00',
        endTime: '17:00',
        rotationIntervalDays: '',
      })
      toast({ variant: 'success', title: 'Schedule block added' })
    },
    onError: () => toast({ variant: 'error', title: 'Could not add schedule block' }),
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

  const tasks = tasksQuery.data ?? []
  const courses = coursesQuery.data ?? []
  const scheduleBlocks = scheduleBlocksQuery.data ?? []
  const reminders = remindersQuery.data ?? []
  const [upcomingSort, setUpcomingSort] = useState<'asc' | 'desc'>('asc')

  const todayTasks = useMemo(() => {
    const todayKey = toDateKey(new Date())
    return tasks.filter((task) => task.dueAt && toDateKey(new Date(task.dueAt)) === todayKey)
  }, [tasks])

  const upcomingTasks = useMemo(() => {
    const now = Date.now()
    const list = tasks.filter((task) => {
      if (task.status === 'done') return false
      if (!task.dueAt) return true
      return new Date(task.dueAt).getTime() >= now
    })

    list.sort((a, b) => {
      const aTs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      const bTs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      return upcomingSort === 'asc' ? aTs - bTs : bTs - aTs
    })

    return list
  }, [tasks, upcomingSort])

  const onStartFocusForTask = (task: OrganizationTaskDto) => {
    const taskTitle = task.kind === 'exam' ? `Exam: ${task.title}` : task.title
    const courseName = task.courseId ? courses.find((course) => course.id === task.courseId)?.name ?? null : null

    timerSession.setActiveTask(
      {
        id: task.id,
        name: taskTitle,
        description: task.description,
        courseId: task.courseId,
        courseName,
        activityId: task.activityId,
      },
      { sessionType: 'pomodoro', sessionStartTime: new Date().toISOString() },
    )

    onStartFocusTask?.()
  }

  const onEditTask = (task: OrganizationTaskDto) => {
    const nextTitle = window.prompt('Edit task title', task.title)?.trim()
    if (!nextTitle || nextTitle === task.title) return
    updateTaskMutation.mutate({ id: task.id, payload: { title: nextTitle } })
  }

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
      <PageContainer className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-80 w-full" />
      </PageContainer>
    )
  }

  const overview = overviewQuery.data ?? {
    plannedMinutes: 0,
    actualMinutes: 0,
    missedSessions: 0,
    varianceMinutes: 0,
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarPlus2 className="h-4 w-4 text-primary" />
            🗓️ Study Planner
          </span>
        }
        subtitle="Tasks first. Then schedule and reminders."
        actions={(
          <Button
            onClick={() => {
              setActiveTab('tasks')
              setTaskComposerOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        )}
      />

      <section className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/80 p-1">
        <Button
          variant={activeTab === 'tasks' ? 'secondary' : 'ghost'}
          className="h-9 flex-1"
          onClick={() => setActiveTab('tasks')}
        >
          Tasks
        </Button>
        <Button
          variant={activeTab === 'schedule' ? 'secondary' : 'ghost'}
          className="h-9 flex-1"
          onClick={() => setActiveTab('schedule')}
        >
          Schedule
        </Button>
        <Button
          variant={activeTab === 'reminders' ? 'secondary' : 'ghost'}
          className="h-9 flex-1"
          onClick={() => setActiveTab('reminders')}
        >
          Reminders
        </Button>
      </section>

      {activeTab === 'tasks' ? (
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Today&apos;s Tasks</h2>
                <Badge variant="outline">{todayTasks.length}</Badge>
              </div>
              <div className="space-y-2">
                {todayTasks.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                    No tasks due today.
                  </p>
                ) : (
                  todayTasks.slice(0, 5).map((task) => (
                    <div key={task.id} className="rounded-md border border-border/70 bg-background/70 p-2.5">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No due time'}
                      </p>
                      <Button size="sm" variant="outline" className="mt-2 h-7 gap-1.5 px-2.5 text-xs" onClick={() => onStartFocusForTask(task)}>
                        <Play className="h-3 w-3" />
                        Start Focus
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <h2 className="mb-3 text-sm font-semibold">Active Task</h2>
              {timerSession.activeTaskId ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold">{timerSession.activeTaskName}</p>
                  {timerSession.activeTaskCourseName ? (
                    <p className="mt-1 text-xs text-muted-foreground">Course: {timerSession.activeTaskCourseName}</p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => onStartFocusTask?.()}>
                      Start Focus
                    </Button>
                    <Button size="sm" variant="outline" onClick={timerSession.clearActiveTask}>
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                  No active task.
                </p>
              )}
            </div>
          </div>

          {taskComposerOpen ? (
            <div className="rounded-xl border border-border/70 bg-card/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Quick Add Task</h2>
                <Button variant="ghost" size="sm" onClick={() => setTaskComposerOpen(false)}>Close</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={taskComposer.title}
                  onChange={(event) => setTaskComposer((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Task title"
                />
                <Input
                  type="datetime-local"
                  value={taskComposer.dueAt}
                  onChange={(event) => setTaskComposer((current) => ({ ...current, dueAt: event.target.value }))}
                />
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 text-sm"
                  value={taskComposer.courseId}
                  onChange={(event) => setTaskComposer((current) => ({ ...current, courseId: event.target.value }))}
                >
                  <option value="">No course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 text-sm"
                  value={taskComposer.priority}
                  onChange={(event) => setTaskComposer((current) => ({ ...current, priority: event.target.value as 'low' | 'medium' | 'high' }))}
                >
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
              </div>
              <Button
                className="mt-3"
                onClick={() =>
                  createTaskMutation.mutate({
                    title: taskComposer.title.trim(),
                    dueAt: taskComposer.dueAt ? new Date(taskComposer.dueAt).toISOString() : undefined,
                    kind: 'task',
                    priority: taskComposer.priority,
                    courseId: taskComposer.courseId || null,
                    status: 'todo',
                  })
                }
                disabled={!taskComposer.title.trim() || createTaskMutation.isPending}
              >
                <Plus className="h-4 w-4" />
                Create Task
              </Button>
            </div>
          ) : null}

          <div className="space-y-3 rounded-xl border border-border/70 bg-card/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Upcoming Tasks</h2>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Sort</span>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={upcomingSort}
                  onChange={(event) => setUpcomingSort(event.target.value as 'asc' | 'desc')}
                >
                  <option value="asc">Date: soonest</option>
                  <option value="desc">Date: latest</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              {upcomingTasks.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                  No upcoming tasks.
                </p>
              ) : (
                upcomingTasks.map((task) => {
                  const taskCourse = task.courseId ? courses.find((course) => course.id === task.courseId)?.name ?? 'Unknown course' : 'No course'
                  const priorityTone =
                    task.priority === 'high'
                      ? 'border-rose-300 bg-rose-100 text-rose-700'
                      : task.priority === 'medium'
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : 'border-slate-300 bg-slate-100 text-slate-700'
                  return (
                    <div key={task.id} className="rounded-lg border border-border/70 bg-background/75 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{task.kind === 'exam' ? `Exam: ${task.title}` : task.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {task.dueAt ? new Date(task.dueAt).toLocaleString() : 'No deadline'} • {taskCourse}
                          </p>
                        </div>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', priorityTone)}>
                          {task.priority}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => onStartFocusForTask(task)}>
                          <Play className="h-3 w-3" />
                          Start Focus
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onEditTask(task)}>
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5 text-xs text-destructive hover:text-destructive"
                          onClick={() => deleteTaskMutation.mutate(task.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                        {timerSession.activeTaskId === task.id ? (
                          <span className="rounded-full border border-emerald-400/40 bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            Running
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'schedule' ? (
        <section className="space-y-5">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekStart((current) => addDays(current, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Badge className="min-w-[170px] flex-1 justify-center sm:flex-none">{weekLabel}</Badge>
            <Button variant="outline" size="icon" onClick={() => setWeekStart((current) => addDays(current, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

        <div className="rounded-xl border border-border/70 bg-card/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Timetable Builder</h2>
            <span className="text-xs text-muted-foreground">One primary action: add block schedule</span>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            <Input
              className="md:col-span-2"
              value={scheduleComposer.title}
              onChange={(event) => setScheduleComposer((current) => ({ ...current, title: event.target.value }))}
              placeholder="Block title"
            />
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 text-sm"
              value={scheduleComposer.dayOfWeek}
              onChange={(event) => setScheduleComposer((current) => ({ ...current, dayOfWeek: Number(event.target.value) }))}
            >
              {weekdayLabels.map((day, index) => (
                <option key={day} value={index + 1}>{day}</option>
              ))}
            </select>
            <Input
              type="time"
              value={scheduleComposer.startTime}
              onChange={(event) => setScheduleComposer((current) => ({ ...current, startTime: event.target.value }))}
            />
            <Input
              type="time"
              value={scheduleComposer.endTime}
              onChange={(event) => setScheduleComposer((current) => ({ ...current, endTime: event.target.value }))}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="w-44"
              type="number"
              min={0}
              value={scheduleComposer.rotationIntervalDays}
              onChange={(event) => setScheduleComposer((current) => ({ ...current, rotationIntervalDays: event.target.value }))}
              placeholder="Rotate every N days"
            />
            <Button
              onClick={() =>
                createScheduleBlockMutation.mutate({
                  title: scheduleComposer.title.trim(),
                  dayOfWeek: scheduleComposer.dayOfWeek,
                  startTime: scheduleComposer.startTime,
                  endTime: scheduleComposer.endTime,
                  rotationIntervalDays: scheduleComposer.rotationIntervalDays
                    ? Math.max(1, Number(scheduleComposer.rotationIntervalDays))
                    : undefined,
                })
              }
              disabled={!scheduleComposer.title.trim() || createScheduleBlockMutation.isPending}
            >
              <Plus className="h-4 w-4" />
              Add Block Schedule
            </Button>
          </div>

          {scheduleBlocks.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {scheduleBlocks.slice(0, 10).map((block) => (
                <div key={block.id} className="rounded-lg border border-border/70 bg-background/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{block.title}</p>
                    <Badge variant="outline">{weekdayLabels[Math.max(0, block.dayOfWeek - 1)]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {block.startTime} - {block.endTime}
                    {block.rotationIntervalDays ? ` • every ${block.rotationIntervalDays}d` : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border/70 bg-card/80 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Weekly Schedule Grid</h2>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>Planned {formatMinutes(overview.plannedMinutes)}</span>
              <span>Actual {formatMinutes(overview.actualMinutes)}</span>
              <span>Variance {overview.varianceMinutes > 0 ? '+' : ''}{formatMinutes(overview.varianceMinutes)}</span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          {weekDays.map((day, index) => {
            const key = toDateKey(day)
            const dayBlocks = blocksByDay.get(key) ?? []
            return (
              <div
                key={key}
                className="min-w-0 rounded-lg border border-border/70 bg-background/70 p-2"
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
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === 'reminders' ? (
        <section className="space-y-3 rounded-xl border border-border/70 bg-card/80 p-4">
          <h2 className="text-sm font-semibold">Reminders</h2>
          {reminders.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              No reminders yet.
            </p>
          ) : (
            reminders
              .slice()
              .sort((a, b) => new Date(a.nextTriggerAt ?? a.remindAt).getTime() - new Date(b.nextTriggerAt ?? b.remindAt).getTime())
              .slice(0, 24)
              .map((reminder) => (
                <div key={reminder.id} className="rounded-md border border-border/70 bg-background/75 p-3">
                  <p className="text-sm font-medium">{reminder.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Next: {new Date(reminder.nextTriggerAt ?? reminder.remindAt).toLocaleString()} • {reminder.repeatRule}
                  </p>
                </div>
              ))
          )}
        </section>
      ) : null}

      <PlannerEditorDialog
        open={Boolean(editorState)}
        state={editorState}
        onOpenChange={(open) => {
          if (!open) setEditorState(null)
        }}
        onSaved={() => setEditorState(null)}
      />
    </PageContainer>
  )
}
