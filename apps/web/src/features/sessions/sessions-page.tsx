import { type FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock3, ListChecks, NotebookPen, PlusCircle } from 'lucide-react'

import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type { ActivityDto, CourseDto, CreateSessionDto, SessionDto } from '@/api/dtos'
import { createSession, getSessions } from '@/api/sessions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const sessionsQueryKey = ['sessions'] as const
const coursesQueryKey = ['courses'] as const
const activitiesQueryKey = ['activities'] as const

type SessionFormState = {
  date: string
  startTime: string
  endTime: string
  breakMinutes: string
  courseId: string
  activityId: string
  note: string
}

const emptyForm: SessionFormState = {
  date: toDateInput(new Date()),
  startTime: '09:00',
  endTime: '10:00',
  breakMinutes: '0',
  courseId: '',
  activityId: '',
  note: '',
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function toDateTimeIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString()
}

function formatDate(dateIso: string) {
  return new Date(dateIso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(dateIso: string) {
  return new Date(dateIso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function computeDuration(startIso: string, endIso: string, breakMinutes: number) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  const raw = Math.round((end - start) / 60000)
  return Math.max(0, raw - breakMinutes)
}

function buildOptimisticSession(
  payload: CreateSessionDto,
  courses: CourseDto[],
  activities: ActivityDto[],
): SessionDto {
  const now = new Date().toISOString()
  const course = courses.find((item) => item.id === payload.courseId)

  if (!course) {
    throw new Error('Course not found for optimistic session')
  }

  const activity = payload.activityId
    ? activities.find((item) => item.id === payload.activityId) ?? null
    : null

  return {
    id: `temp-${Date.now()}`,
    userId: 'swot-user',
    courseId: payload.courseId,
    activityId: payload.activityId ?? null,
    startTime: payload.startTime,
    endTime: payload.endTime,
    breakMinutes: payload.breakMinutes ?? 0,
    durationMinutes: computeDuration(payload.startTime, payload.endTime, payload.breakMinutes ?? 0),
    note: payload.note ?? null,
    createdAt: now,
    updatedAt: now,
    course,
    activity,
  }
}

function LogSessionDialog({ courses, activities }: { courses: CourseDto[]; activities: ActivityDto[] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<SessionFormState>(() => ({
    ...emptyForm,
    courseId: courses[0]?.id ?? '',
  }))

  const filteredActivities = useMemo(
    () => activities.filter((activity) => activity.courseId === form.courseId),
    [activities, form.courseId],
  )

  const canLogSession = courses.length > 0

  const mutation = useMutation({
    mutationFn: createSession,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: sessionsQueryKey })

      const previousSessions = queryClient.getQueryData<SessionDto[]>(sessionsQueryKey) ?? []
      const optimisticSession = buildOptimisticSession(payload, courses, activities)

      queryClient.setQueryData<SessionDto[]>(sessionsQueryKey, [optimisticSession, ...previousSessions])

      return { previousSessions, optimisticId: optimisticSession.id }
    },
    onError: (_error, _payload, context) => {
      if (context?.previousSessions) {
        queryClient.setQueryData(sessionsQueryKey, context.previousSessions)
      }
      setError('Failed to save session. Please try again.')
    },
    onSuccess: (savedSession, _payload, context) => {
      queryClient.setQueryData<SessionDto[]>(sessionsQueryKey, (current = []) =>
        current.map((item) => (item.id === context?.optimisticId ? savedSession : item)),
      )

      setOpen(false)
      setForm({
        ...emptyForm,
        courseId: courses[0]?.id ?? '',
      })
      setError(null)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey })
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const breakMinutes = Number(form.breakMinutes || 0)
    const startTime = toDateTimeIso(form.date, form.startTime)
    const endTime = toDateTimeIso(form.date, form.endTime)

    if (!form.courseId) {
      setError('Please choose a course.')
      return
    }

    if (Number.isNaN(breakMinutes) || breakMinutes < 0) {
      setError('Break minutes must be a non-negative number.')
      return
    }

    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      setError('End time must be after start time.')
      return
    }

    const payload: CreateSessionDto = {
      courseId: form.courseId,
      activityId: form.activityId || undefined,
      startTime,
      endTime,
      breakMinutes,
      note: form.note.trim() || undefined,
    }

    mutation.mutate(payload)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setForm((current) => ({
            ...current,
            courseId: current.courseId || courses[0]?.id || '',
          }))
        }
        if (!nextOpen) {
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={!canLogSession}>
          <PlusCircle className="h-4 w-4" />
          Log past session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Past Session</DialogTitle>
          <DialogDescription>
            Capture a completed study block. It will appear in Sessions immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <Input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start time</label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    startTime: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">End time</label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Break minutes</label>
              <Input
                type="number"
                min={0}
                value={form.breakMinutes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    breakMinutes: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Course</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.courseId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    courseId: event.target.value,
                    activityId: '',
                  }))
                }
                required
              >
                <option value="" disabled>
                  Select a course
                </option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Activity</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.activityId}
                onChange={(event) => setForm((current) => ({ ...current, activityId: event.target.value }))}
                disabled={!form.courseId || filteredActivities.length === 0}
              >
                <option value="">No activity</option>
                {filteredActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Note</label>
            <Textarea
              placeholder="What did you work on?"
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EmptyState({ hasCourses }: { hasCourses: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <NotebookPen className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold">No sessions logged yet</p>
          <p className="text-sm text-muted-foreground">
            {hasCourses
              ? 'Use “Log past session” to add your first entry.'
              : 'Create a course first, then log your session.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function SessionsPage() {
  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: ({ signal }) => getSessions(signal),
  })
  const coursesQuery = useQuery({
    queryKey: coursesQueryKey,
    queryFn: ({ signal }) => getCourses(signal),
  })
  const activitiesQuery = useQuery({
    queryKey: activitiesQueryKey,
    queryFn: ({ signal }) => getActivities(signal),
  })

  const sessions = sessionsQuery.data ?? []
  const courses = coursesQuery.data ?? []
  const activities = activitiesQuery.data ?? []

  const isLoading = sessionsQuery.isPending || coursesQuery.isPending || activitiesQuery.isPending
  const hasError = sessionsQuery.isError || coursesQuery.isError || activitiesQuery.isError

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground">
            Review your study logs and add missed sessions with precision.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{sessions.length} total</Badge>
          <LogSessionDialog courses={courses} activities={activities} />
        </div>
      </div>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-primary" />
            Session Log
          </CardTitle>
          <CardDescription>Track date, time window, duration, and context for each study block.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-sm text-muted-foreground">Loading sessions...</p>
          ) : hasError ? (
            <p className="py-6 text-sm text-destructive">
              Could not load sessions data. Check backend connectivity and try again.
            </p>
          ) : sessions.length === 0 ? (
            <EmptyState hasCourses={courses.length > 0} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/70 bg-background/75">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Date
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        Start
                      </span>
                    </TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{formatDate(session.startTime)}</TableCell>
                      <TableCell>{formatTime(session.startTime)}</TableCell>
                      <TableCell>{formatTime(session.endTime)}</TableCell>
                      <TableCell>{formatDuration(session.durationMinutes)}</TableCell>
                      <TableCell>{session.course?.name ?? '-'}</TableCell>
                      <TableCell>
                        {session.activity ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-1 text-xs">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: session.activity.color }}
                            />
                            {session.activity.name}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground">
                        {session.note || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
