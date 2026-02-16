import { type ComponentType, type ReactNode, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Award,
  CalendarDays,
  Flame,
  Goal,
  Medal,
  Timer,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { getActivities } from '@/api/activities'
import { getMe } from '@/api/me'
import { getSessions } from '@/api/sessions'
import type { SessionDto } from '@/api/dtos'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const sessionsQueryKey = ['sessions'] as const
const meQueryKey = ['me'] as const

const schoolLabels = ['School Year 2025/26 - Grade 10', 'School Year 2025/26 - Grade 11', 'School Year 2025/26 - Grade 12']
const fallbackCourseColors = ['#e11d77', '#fb7185', '#f43f5e', '#fda4af', '#ec4899', '#be185d']

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function isoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

function formatMinutes(value: number) {
  if (value < 60) return `${value}m`
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function sumSessions(sessions: SessionDto[], start: Date, end: Date) {
  const startMs = start.getTime()
  const endMs = end.getTime()

  return sessions.reduce((total, session) => {
    const sessionMs = new Date(session.startTime).getTime()
    if (sessionMs < startMs || sessionMs >= endMs) return total
    return total + session.durationMinutes
  }, 0)
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { minutes?: number } }>; label?: string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-sm shadow-lg">
      {label ? <p className="font-semibold text-foreground">{label}</p> : null}
      {payload.map((item) => (
        <p key={item.name} className="text-muted-foreground">
          {item.name}: <span className="font-medium text-foreground">{formatMinutes(item.value ?? item.payload?.minutes ?? 0)}</span>
        </p>
      ))}
    </div>
  )
}

function Tile({
  title,
  value,
  description,
  icon: Icon,
  extra,
}: {
  title: string
  value: string
  description: string
  icon: ComponentType<{ className?: string }>
  extra?: ReactNode
}) {
  return (
    <Card className="shadow-soft">
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center justify-between">
          {title}
          <Icon className="h-4 w-4 text-primary" />
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        {extra}
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const [schoolLabel, setSchoolLabel] = useState(schoolLabels[1])

  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: ({ signal }) => getSessions(signal),
  })
  const meQuery = useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => getMe(signal),
  })
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: ({ signal }) => getActivities(signal),
  })

  const now = new Date()
  const todayStart = startOfDay(now)
  const tomorrow = addDays(todayStart, 1)
  const mondayOffset = (todayStart.getDay() + 6) % 7
  const weekStart = addDays(todayStart, -mondayOffset)
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)

  const sessions = sessionsQuery.data ?? []
  const activities = activitiesQuery.data ?? []
  const courseColorByCourseId = useMemo(() => {
    const map = new Map<string, string>()
    activities.forEach((activity) => {
      if (!map.has(activity.courseId)) {
        map.set(activity.courseId, activity.color)
      }
    })
    return map
  }, [activities])

  const metrics = useMemo(() => {
    const todayMinutes = sumSessions(sessions, todayStart, tomorrow)
    const weekMinutes = sumSessions(sessions, weekStart, tomorrow)
    const monthMinutes = sumSessions(sessions, monthStart, tomorrow)

    const byDay = new Map<string, number>()
    const byCourse = new Map<string, { name: string; minutes: number; color: string | null }>()
    const byWeekday = [0, 0, 0, 0, 0, 0, 0]

    sessions.forEach((session) => {
      const startedAt = new Date(session.startTime)
      const day = startOfDay(startedAt)
      const key = dateKey(day)
      byDay.set(key, (byDay.get(key) ?? 0) + session.durationMinutes)

      const courseId = session.courseId
      const courseName = session.course?.name || 'Unknown'
      const existing = byCourse.get(courseId)
      const activityColor = session.activity?.color ?? null
      byCourse.set(courseId, {
        name: courseName,
        minutes: (existing?.minutes ?? 0) + session.durationMinutes,
        color: existing?.color ?? activityColor ?? courseColorByCourseId.get(courseId) ?? null,
      })

      const dayIndex = (startedAt.getDay() + 6) % 7
      byWeekday[dayIndex] += session.durationMinutes
    })

    let streak = 0
    for (let cursor = todayStart; ; cursor = addDays(cursor, -1)) {
      const key = dateKey(cursor)
      if ((byDay.get(key) ?? 0) > 0) {
        streak += 1
      } else {
        break
      }
    }

    let bronze = 0
    let silver = 0
    let gold = 0
    byDay.forEach((minutes) => {
      if (minutes >= 180) {
        gold += 1
      } else if (minutes >= 120) {
        silver += 1
      } else if (minutes >= 60) {
        bronze += 1
      }
    })

    const courseChart = Array.from(byCourse.entries())
      .map(([courseId, value], index) => ({
        courseId,
        course: value.name,
        minutes: value.minutes,
        color: value.color ?? fallbackCourseColors[index % fallbackCourseColors.length],
      }))
      .sort((a, b) => b.minutes - a.minutes)

    const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const weekChart = weekdayLabels.map((day, index) => ({ day, minutes: byWeekday[index] }))

    return {
      todayMinutes,
      weekMinutes,
      monthMinutes,
      streak,
      medals: { bronze, silver, gold },
      courseChart,
      weekChart,
    }
  }, [courseColorByCourseId, monthStart, sessions, todayStart, tomorrow, weekStart])

  const isoWeekday = now.getDay() === 0 ? 7 : now.getDay()
  const todayTarget = meQuery.data?.targets.find((target) => target.weekday === isoWeekday)?.targetMinutes ?? 90
  const todayProgress = Math.min(100, Math.round((metrics.todayMinutes / Math.max(todayTarget, 1)) * 100))

  const hasData = sessions.length > 0

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/80 p-4 shadow-soft">
        <div>
          <p className="text-xl font-semibold text-foreground">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar week {isoWeekNumber(now)}
            </Badge>
            <Badge>{schoolLabel}</Badge>
          </div>
        </div>

        <select
          className="h-10 min-w-64 rounded-md border border-input bg-background px-3 text-sm"
          value={schoolLabel}
          onChange={(event) => setSchoolLabel(event.target.value)}
        >
          {schoolLabels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          title="Today Minutes"
          value={formatMinutes(metrics.todayMinutes)}
          description={`Target: ${formatMinutes(todayTarget)}`}
          icon={Timer}
          extra={
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${todayProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{todayProgress}% of daily target</p>
            </div>
          }
        />
        <Tile
          title="Week Minutes"
          value={formatMinutes(metrics.weekMinutes)}
          description="Monday to today"
          icon={CalendarDays}
        />
        <Tile
          title="Month Minutes"
          value={formatMinutes(metrics.monthMinutes)}
          description="Current month total"
          icon={Goal}
        />
        <Tile title="Streak" value={`${metrics.streak} day${metrics.streak === 1 ? '' : 's'}`} description="Consecutive active days" icon={Flame} />
        <Tile
          title="Medals"
          value={`${metrics.medals.gold + metrics.medals.silver + metrics.medals.bronze}`}
          description="Daily performance awards"
          icon={Award}
          extra={
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                <Medal className="h-3.5 w-3.5" /> G {metrics.medals.gold}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">
                <Medal className="h-3.5 w-3.5" /> S {metrics.medals.silver}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-orange-700">
                <Medal className="h-3.5 w-3.5" /> B {metrics.medals.bronze}
              </span>
            </div>
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>Minutes by Course</CardTitle>
            <CardDescription>Distribution of focused time across your subjects.</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {!hasData ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No sessions yet to visualize.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.courseChart}
                    dataKey="minutes"
                    nameKey="course"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                  >
                    {metrics.courseChart.map((entry) => (
                      <Cell key={entry.courseId} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>Time Analysis</CardTitle>
            <CardDescription>Minutes by day of week based on your logged sessions.</CardDescription>
          </CardHeader>
          <CardContent className="h-[320px]">
            {!hasData ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No sessions yet to analyze.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.weekChart} barCategoryGap={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5d4df" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `${value}m`} tickLine={false} axisLine={false} width={46} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="minutes" fill="#e11d77" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>
    </section>
  )
}
