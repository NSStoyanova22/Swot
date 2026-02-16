import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Clock3, Coffee, Lock, Sparkles, Target } from 'lucide-react'

import { getSessions } from '@/api/sessions'
import type { SessionDto } from '@/api/dtos'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const MIN_SESSIONS_TO_UNLOCK = 5

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatMinutes(value: number) {
  if (value < 60) return `${Math.round(value)}m`
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function hourBucket(hour: number) {
  if (hour >= 5 && hour < 9) return 'Early (5-9)'
  if (hour >= 9 && hour < 13) return 'Morning (9-13)'
  if (hour >= 13 && hour < 17) return 'Afternoon (13-17)'
  if (hour >= 17 && hour < 21) return 'Evening (17-21)'
  return 'Night (21-5)'
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0
  const avg = average(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function insightsFromSessions(sessions: SessionDto[]) {
  const dayMinutes = [0, 0, 0, 0, 0, 0, 0]
  const hourRange = new Map<string, number>()
  const courseDurations = new Map<string, number[]>()
  const breakMinutes: number[] = []

  sessions.forEach((session) => {
    const start = new Date(session.startTime)
    const dayIndex = (start.getDay() + 6) % 7
    dayMinutes[dayIndex] += session.durationMinutes

    const bucket = hourBucket(start.getHours())
    hourRange.set(bucket, (hourRange.get(bucket) ?? 0) + session.durationMinutes)

    const courseName = session.course?.name ?? 'Unknown'
    const existing = courseDurations.get(courseName) ?? []
    existing.push(session.durationMinutes)
    courseDurations.set(courseName, existing)

    breakMinutes.push(session.breakMinutes)
  })

  const dayChart = weekdayLabels.map((day, index) => ({ day, minutes: dayMinutes[index] }))
  const bestDay = dayChart.reduce((best, current) => (current.minutes > best.minutes ? current : best), dayChart[0])

  const bucketOrder = ['Early (5-9)', 'Morning (9-13)', 'Afternoon (13-17)', 'Evening (17-21)', 'Night (21-5)']
  const hourChart = bucketOrder.map((bucket) => ({ bucket, minutes: hourRange.get(bucket) ?? 0 }))
  const bestHourRange = hourChart.reduce((best, current) => (current.minutes > best.minutes ? current : best), hourChart[0])

  const courseConsistency = Array.from(courseDurations.entries())
    .map(([course, durations]) => ({
      course,
      sessions: durations.length,
      avg: average(durations),
      deviation: stdDev(durations),
    }))
    .filter((item) => item.sessions >= 2)
    .sort((a, b) => a.deviation - b.deviation)

  const mostConsistentCourse = courseConsistency[0] ?? null

  const averageSessionLength = average(sessions.map((session) => session.durationMinutes))
  const averageBreak = average(breakMinutes)
  const breakUsageRate = (breakMinutes.filter((value) => value > 0).length / Math.max(1, breakMinutes.length)) * 100

  let breakPatternText = 'You mostly study in uninterrupted blocks.'
  if (breakUsageRate >= 70) {
    breakPatternText = 'You use breaks frequently, which supports sustainable focus.'
  } else if (breakUsageRate >= 35) {
    breakPatternText = 'You mix focused blocks with occasional breaks.'
  }

  return {
    dayChart,
    hourChart,
    bestDay,
    bestHourRange,
    mostConsistentCourse,
    averageSessionLength,
    averageBreak,
    breakUsageRate,
    breakPatternText,
  }
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatMinutes(payload[0]?.value ?? 0)}</p>
    </div>
  )
}

export function InsightsPage() {
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: ({ signal }) => getSessions({}, signal),
  })

  const sessions = sessionsQuery.data ?? []
  const unlocked = sessions.length >= MIN_SESSIONS_TO_UNLOCK

  const insights = useMemo(() => insightsFromSessions(sessions), [sessions])

  if (sessionsQuery.isPending) {
    return (
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="shadow-soft">
            <CardHeader className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-36" />
            </CardContent>
          </Card>
        ))}
      </section>
    )
  }

  if (sessionsQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Could not load insights right now.
      </div>
    )
  }

  if (!unlocked) {
    const remaining = MIN_SESSIONS_TO_UNLOCK - sessions.length

    return (
      <Card className="mx-auto max-w-2xl shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Insights Locked
          </CardTitle>
          <CardDescription>
            Log a few more sessions and we will unlock your personalized learning patterns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            You have <span className="font-semibold">{sessions.length}</span> session(s). Add{' '}
            <span className="font-semibold">{remaining}</span> more to unlock Insights.
          </p>
          <div className="h-2 rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (sessions.length / MIN_SESSIONS_TO_UNLOCK) * 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Best Day
              <Target className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.bestDay.day}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Most minutes: {formatMinutes(insights.bestDay.minutes)}</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Best Hour Range
              <Clock3 className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.bestHourRange.bucket}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Most minutes: {formatMinutes(insights.bestHourRange.minutes)}</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Consistent Course
              <BarChart3 className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.mostConsistentCourse?.course ?? 'Keep logging'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {insights.mostConsistentCourse
                ? `Low variance (${Math.round(insights.mostConsistentCourse.deviation)} min)`
                : 'Need at least 2 sessions in a course'}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Avg Session Length
              <Sparkles className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{formatMinutes(insights.averageSessionLength)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Across {sessions.length} sessions</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Break Pattern
              <Coffee className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{Math.round(insights.breakUsageRate)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Sessions with breaks</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle>Pattern Highlights</CardTitle>
          <CardDescription>
            Friendly summary: {insights.breakPatternText}
          </CardDescription>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Avg break: {formatMinutes(insights.averageBreak)}</Badge>
            <Badge variant="outline">Peak day: {insights.bestDay.day}</Badge>
            <Badge variant="outline">Peak range: {insights.bestHourRange.bucket}</Badge>
          </div>
        </CardHeader>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>Minutes by Day of Week</CardTitle>
            <CardDescription>Your consistency rhythm across the week.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <BarChart data={insights.dayChart} barCategoryGap={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5d4df" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value) => `${value}m`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="minutes" fill="#e11d77" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>Minutes by Hour Range</CardTitle>
            <CardDescription>When your focus time naturally clusters.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <BarChart data={insights.hourChart} barCategoryGap={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5d4df" />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} interval={0} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value) => `${value}m`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="minutes" fill="#fb7185" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>
    </section>
  )
}
