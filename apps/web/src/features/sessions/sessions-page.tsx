import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock3, ListChecks, NotebookPen, PlusCircle, Search } from 'lucide-react'

import { createSessionDistraction, getSessionDistractions } from '@/api/distractions'
import { getActivities } from '@/api/activities'
import { getCourses } from '@/api/courses'
import type {
  ActivityDto,
  CourseDto,
  CreateDistractionDto,
  CreateSessionDto,
  SessionDto,
} from '@/api/dtos'
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
import { MarkdownNoteEditor } from '@/components/ui/markdown-note-editor'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const sessionsQueryBaseKey = ['sessions'] as const
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

function LogSessionDialog({
  courses,
  activities,
  openSignal = 0,
}: {
  courses: CourseDto[]
  activities: ActivityDto[]
  openSignal?: number
}) {
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

  useEffect(() => {
    if (openSignal <= 0) return
    setOpen(true)
  }, [openSignal])

  const mutation = useMutation({
    mutationFn: createSession,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: sessionsQueryBaseKey })
      const previousSessions = queryClient.getQueriesData<SessionDto[]>({
        queryKey: sessionsQueryBaseKey,
      })
      const optimisticSession = buildOptimisticSession(payload, courses, activities)

      queryClient.setQueriesData<SessionDto[]>(
        { queryKey: sessionsQueryBaseKey },
        (current = []) => [optimisticSession, ...current],
      )

      return { previousSessions, optimisticId: optimisticSession.id }
    },
    onError: (_error, _payload, context) => {
      if (context?.previousSessions) {
        context.previousSessions.forEach(([key, value]) => {
          queryClient.setQueryData(key, value)
        })
      }
      setError('Failed to save session. Please try again.')
    },
    onSuccess: (savedSession, _payload, context) => {
      queryClient.setQueriesData<SessionDto[]>({ queryKey: sessionsQueryBaseKey }, (current = []) =>
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
      queryClient.invalidateQueries({ queryKey: sessionsQueryBaseKey })
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['productivity'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-insights'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-prediction'] })
      queryClient.invalidateQueries({ queryKey: ['timer-recommendation'] })
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
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

          <MarkdownNoteEditor
            label="Note (Markdown)"
            value={form.note}
            onChange={(value) => setForm((current) => ({ ...current, note: value }))}
            placeholder="What did you work on? Use Markdown like **bold**, lists, or links."
          />

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

function DistractionDialog({
  session,
  open,
  onOpenChange,
}: {
  session: SessionDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [type, setType] = useState<CreateDistractionDto['type']>('phone')
  const [minutesLost, setMinutesLost] = useState('3')
  const [note, setNote] = useState('')

  const distractionsQuery = useQuery({
    queryKey: ['session-distractions', session?.id],
    queryFn: ({ signal }) =>
      session ? getSessionDistractions(session.id, signal) : Promise.resolve([]),
    enabled: open && Boolean(session),
  })

  const mutation = useMutation({
    mutationFn: (payload: CreateDistractionDto) => {
      if (!session) throw new Error('No session selected')
      return createSessionDistraction(session.id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-distractions', session?.id] })
      queryClient.invalidateQueries({ queryKey: ['distractions-analytics'] })
      setNote('')
      setMinutesLost('3')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Distraction</DialogTitle>
          <DialogDescription>
            Track interruptions for this session to improve focus analytics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Type</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as CreateDistractionDto['type'])}
                className="flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm"
              >
                <option value="phone">Phone</option>
                <option value="social_media">Social media</option>
                <option value="noise">Noise</option>
                <option value="tiredness">Tiredness</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Minutes lost</span>
              <Input
                type="number"
                min={0}
                value={minutesLost}
                onChange={(event) => setMinutesLost(event.target.value)}
              />
            </label>
          </div>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Note</span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional context"
            />
          </label>

          <Button
            onClick={() =>
              mutation.mutate({
                type,
                minutesLost: Number(minutesLost || 0),
                note: note.trim() || undefined,
              })
            }
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : 'Save distraction'}
          </Button>

          <div className="space-y-2 rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-sm font-medium">Recent distractions</p>
            {distractionsQuery.data?.length ? (
              distractionsQuery.data.map((item) => (
                <div key={item.id} className="text-xs text-muted-foreground">
                  {item.label} • {item.minutesLost}m {item.note ? `• ${item.note}` : ''}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No distractions logged yet for this session.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SessionsPage({ openCreateSignal = 0 }: { openCreateSignal?: number }) {
  const [noteSearch, setNoteSearch] = useState('')
  const [previewNotes, setPreviewNotes] = useState(false)
  const noteQuery = noteSearch.trim()

  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'note-search', noteQuery],
    queryFn: ({ signal }) => getSessions(noteQuery ? { q: noteQuery } : {}, signal),
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
  const [distractionSession, setDistractionSession] = useState<SessionDto | null>(null)

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground">
            Review your study logs and add missed sessions with precision.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={noteSearch}
              onChange={(event) => setNoteSearch(event.target.value)}
              placeholder="Search notes..."
              className="pl-8"
            />
          </div>
          <Button variant={previewNotes ? 'outline' : 'ghost'} size="sm" onClick={() => setPreviewNotes((current) => !current)}>
            {previewNotes ? 'Plain note view' : 'Preview notes'}
          </Button>
          <Badge variant="outline">{sessions.length} total</Badge>
          <LogSessionDialog courses={courses} activities={activities} openSignal={openCreateSignal} />
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
            noteQuery ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No sessions match note search <span className="font-medium">"{noteQuery}"</span>.
                </CardContent>
              </Card>
            ) : (
              <EmptyState hasCourses={courses.length > 0} />
            )
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
                    <TableHead>Focus</TableHead>
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
                      <TableCell className="max-w-[280px] text-muted-foreground">
                        {previewNotes ? (
                          <MarkdownPreview
                            value={session.note ?? ''}
                            className="max-h-24 overflow-y-auto text-xs"
                            emptyLabel="-"
                          />
                        ) : (
                          <p className="truncate">{session.note || '-'}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDistractionSession(session)}
                        >
                          Log distraction
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DistractionDialog
        session={distractionSession}
        open={Boolean(distractionSession)}
        onOpenChange={(open) => {
          if (!open) setDistractionSession(null)
        }}
      />
    </section>
  )
}
