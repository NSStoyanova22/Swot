import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Award,
  CalendarDays,
  Flame,
  Goal,
  GripVertical,
  LayoutGrid,
  Medal,
  Plus,
  Save,
  Sparkles,
  Timer,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
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
import { getAnalyticsPrediction } from '@/api/analytics'
import { getDistractionAnalytics } from '@/api/distractions'
import { getAcademicRisk } from '@/api/grades'
import { getMe } from '@/api/me'
import { createOrganizationTask } from '@/api/organization'
import { autoAddPlannerBlocks } from '@/api/planner'
import { getProductivityOverview } from '@/api/productivity'
import { getSessions } from '@/api/sessions'
import { getStreakOverview } from '@/api/streak'
import type { SessionDto } from '@/api/dtos'
import { PageContainer, PageHeader, SectionGrid } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const sessionsQueryKey = ['sessions'] as const
const meQueryKey = ['me'] as const

const schoolLabels = ['School Year 2025/26 - Grade 10', 'School Year 2025/26 - Grade 11', 'School Year 2025/26 - Grade 12']
const fallbackCourseColors = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--primary))',
]
const dashboardOrderStorageKey = 'swot-dashboard-widget-order-v2'
const dashboardEnabledStorageKey = 'swot-dashboard-widget-enabled-v2'

type WidgetId =
  | 'today'
  | 'week'
  | 'month'
  | 'streak'
  | 'productivity'
  | 'prediction'
  | 'medals'
  | 'focusInsights'
  | 'heatmap'
  | 'trend'
  | 'courseChart'
  | 'timeAnalysis'
  | 'atRisk'

const defaultWidgetOrder: WidgetId[] = [
  'today',
  'week',
  'month',
  'streak',
  'productivity',
  'prediction',
  'medals',
  'focusInsights',
  'trend',
  'courseChart',
  'timeAnalysis',
  'atRisk',
  'heatmap',
]

const defaultWidgetEnabled: Record<WidgetId, boolean> = {
  today: true,
  week: true,
  month: true,
  streak: true,
  productivity: true,
  prediction: true,
  medals: true,
  focusInsights: true,
  heatmap: true,
  trend: true,
  courseChart: true,
  timeAnalysis: true,
  atRisk: true,
}

const widgetLabel: Record<WidgetId, string> = {
  today: 'Today Minutes',
  week: 'Week Minutes',
  month: 'Month Minutes',
  streak: 'Streak',
  productivity: 'Productivity',
  prediction: 'Tomorrow Prediction',
  medals: 'Medals',
  focusInsights: 'Focus Insights',
  heatmap: 'Study Heatmap',
  trend: 'Weekly Productivity Trend',
  courseChart: 'Minutes by Course',
  timeAnalysis: 'Time Analysis',
  atRisk: 'At Risk',
}

const widgetLayoutClass: Record<WidgetId, string> = {
  today: 'col-span-1',
  week: 'col-span-1',
  month: 'col-span-1',
  streak: 'col-span-1',
  productivity: 'col-span-1',
  prediction: 'col-span-1',
  medals: 'col-span-1',
  focusInsights: 'md:col-span-2 xl:col-span-2',
  trend: 'md:col-span-1 xl:col-span-2',
  courseChart: 'md:col-span-1 xl:col-span-2',
  timeAnalysis: 'md:col-span-1 xl:col-span-2',
  atRisk: 'md:col-span-1 xl:col-span-2',
  heatmap: 'md:col-span-2 xl:col-span-4',
}

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

function startOfWeekMonday(date: Date) {
  const dayIndex = (date.getDay() + 6) % 7
  return addDays(date, -dayIndex)
}

function endOfWeekSunday(date: Date) {
  const dayIndex = (date.getDay() + 6) % 7
  return addDays(date, 6 - dayIndex)
}

function heatmapCellClass(minutes: number) {
  if (minutes >= 180) return 'bg-primary'
  if (minutes >= 120) return 'bg-primary/85'
  if (minutes >= 60) return 'bg-primary/70'
  if (minutes >= 30) return 'bg-primary/50'
  if (minutes > 0) return 'bg-primary/30'
  return 'bg-muted/60'
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
    <Card className="dashboard-widget flex h-full min-h-[178px] flex-col shadow-soft">
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center justify-between">
          {title}
          <Icon className="h-4 w-4 text-primary" />
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        {extra}
      </CardContent>
    </Card>
  )
}

type DashboardDeepLinkTarget = {
  nav: 'Dashboard' | 'Insights'
  anchorId: string
}

function scrollToAnchor(anchorId: string) {
  const target = document.getElementById(anchorId)
  if (!target) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

export function DashboardPage({
  onDeepLink,
  pendingAnchorId,
  onPendingAnchorHandled,
}: {
  onDeepLink?: (target: DashboardDeepLinkTarget) => void
  pendingAnchorId?: string | null
  onPendingAnchorHandled?: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [schoolLabel, setSchoolLabel] = useState(schoolLabels[1])
  const [heatmapCourseId, setHeatmapCourseId] = useState('all')
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear())
  const [customizeMode, setCustomizeMode] = useState(false)
  const [draggingWidget, setDraggingWidget] = useState<WidgetId | null>(null)
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(defaultWidgetOrder)
  const [widgetEnabled, setWidgetEnabled] = useState<Record<WidgetId, boolean>>(defaultWidgetEnabled)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const storedOrderRaw = window.localStorage.getItem(dashboardOrderStorageKey)
      const storedEnabledRaw = window.localStorage.getItem(dashboardEnabledStorageKey)

      if (storedOrderRaw) {
        const parsed = JSON.parse(storedOrderRaw) as unknown
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((item): item is WidgetId =>
            defaultWidgetOrder.includes(item as WidgetId),
          )
          const missing = defaultWidgetOrder.filter((item) => !valid.includes(item))
          setWidgetOrder([...valid, ...missing])
        }
      }

      if (storedEnabledRaw) {
        const parsed = JSON.parse(storedEnabledRaw) as Partial<Record<WidgetId, boolean>>
        setWidgetEnabled({
          ...defaultWidgetEnabled,
          ...parsed,
        })
      }
    } catch {
      setWidgetOrder(defaultWidgetOrder)
      setWidgetEnabled(defaultWidgetEnabled)
    }
  }, [])

  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: ({ signal }) => getSessions({}, signal),
  })
  const meQuery = useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => getMe(signal),
  })
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: ({ signal }) => getActivities(signal),
  })
  const streakQuery = useQuery({
    queryKey: ['streak'],
    queryFn: ({ signal }) => getStreakOverview(signal),
  })
  const productivityQuery = useQuery({
    queryKey: ['productivity'],
    queryFn: ({ signal }) => getProductivityOverview(signal),
  })
  const predictionQuery = useQuery({
    queryKey: ['analytics-prediction'],
    queryFn: ({ signal }) => getAnalyticsPrediction(signal),
  })
  const distractionQuery = useQuery({
    queryKey: ['distractions-analytics'],
    queryFn: ({ signal }) => getDistractionAnalytics(30, signal),
  })
  const academicRiskQuery = useQuery({
    queryKey: ['academic-risk'],
    queryFn: ({ signal }) => getAcademicRisk({}, signal),
  })
  const addRiskToPlannerMutation = useMutation({
    mutationFn: ({ courseId, minutes }: { courseId: string; minutes: number }) =>
      autoAddPlannerBlocks({
        courseId,
        totalMinutes: minutes,
        weekStartDate: startOfWeekMonday(new Date()).toISOString(),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      toast({
        variant: 'success',
        title: 'Added to Planner',
        description: `Added ${result.blocksCount} block${result.blocksCount === 1 ? '' : 's'} to ${result.dayLabels.join(' + ') || 'this week'}.`,
      })
    },
  })
  const scheduleRevisionMutation = useMutation({
    mutationFn: ({ courseId, courseName }: { courseId: string; courseName: string }) =>
      createOrganizationTask({
        title: `Revision: ${courseName}`,
        kind: 'exam',
        priority: 'high',
        courseId,
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      toast({ variant: 'success', title: 'Revision scheduled' })
    },
  })
  const createChecklistMutation = useMutation({
    mutationFn: ({ courseId, courseName, actions }: { courseId: string; courseName: string; actions: string[] }) =>
      createOrganizationTask({
        title: `Checklist: ${courseName}`,
        kind: 'task',
        priority: 'medium',
        courseId,
        subtasks: actions.slice(0, 3).map((title) => ({ title })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      toast({ variant: 'success', title: 'Checklist created' })
    },
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
      medals: { bronze, silver, gold },
      courseChart,
      weekChart,
    }
  }, [courseColorByCourseId, monthStart, sessions, todayStart, tomorrow, weekStart])

  const isoWeekday = now.getDay() === 0 ? 7 : now.getDay()
  const todayTarget = meQuery.data?.targets.find((target) => target.weekday === isoWeekday)?.targetMinutes ?? 90
  const todayProgress = Math.min(100, Math.round((metrics.todayMinutes / Math.max(todayTarget, 1)) * 100))

  const hasData = sessions.length > 0
  const riskItems = academicRiskQuery.data ?? []
  const streak = streakQuery.data
  const courseOptions = useMemo(() => {
    const map = new Map<string, string>()
    sessions.forEach((session) => {
      if (!map.has(session.courseId)) {
        map.set(session.courseId, session.course?.name ?? 'Unknown')
      }
    })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [sessions])

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    sessions.forEach((session) => years.add(new Date(session.startTime).getFullYear()))
    years.add(new Date().getFullYear())
    return Array.from(years).sort((a, b) => b - a)
  }, [sessions])

  const heatmap = useMemo(() => {
    const filtered = heatmapCourseId === 'all'
      ? sessions
      : sessions.filter((session) => session.courseId === heatmapCourseId)

    const start = startOfWeekMonday(new Date(heatmapYear, 0, 1))
    const end = endOfWeekSunday(new Date(heatmapYear, 11, 31))

    const dayMap = new Map<string, { minutes: number; sessions: number }>()
    filtered.forEach((session) => {
      const day = startOfDay(new Date(session.startTime))
      if (day.getFullYear() !== heatmapYear) return
      const key = dateKey(day)
      const current = dayMap.get(key) ?? { minutes: 0, sessions: 0 }
      dayMap.set(key, {
        minutes: current.minutes + session.durationMinutes,
        sessions: current.sessions + 1,
      })
    })

    const weeks: Array<Array<{ date: Date; inYear: boolean; minutes: number; sessions: number }>> = []
    const monthLabels: Array<{ month: string; column: number }> = []
    let column = 0

    for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 7)) {
      const weekDays: Array<{ date: Date; inYear: boolean; minutes: number; sessions: number }> = []
      for (let i = 0; i < 7; i += 1) {
        const day = addDays(cursor, i)
        const key = dateKey(day)
        const value = dayMap.get(key) ?? { minutes: 0, sessions: 0 }
        weekDays.push({
          date: day,
          inYear: day.getFullYear() === heatmapYear,
          minutes: value.minutes,
          sessions: value.sessions,
        })
      }
      if (weekDays.some((day) => day.date.getDate() === 1 && day.inYear)) {
        const labelDay = weekDays.find((day) => day.date.getDate() === 1 && day.inYear)
        if (labelDay) {
          monthLabels.push({
            month: labelDay.date.toLocaleDateString(undefined, { month: 'short' }),
            column,
          })
        }
      }
      weeks.push(weekDays)
      column += 1
    }

    return { weeks, monthLabels }
  }, [heatmapCourseId, heatmapYear, sessions])

  const visibleWidgets = useMemo(
    () => widgetOrder.filter((widget) => widgetEnabled[widget]),
    [widgetEnabled, widgetOrder],
  )
  const evidenceWidgetSet = useMemo(
    () => new Set<WidgetId>(['trend', 'courseChart', 'timeAnalysis', 'atRisk', 'heatmap']),
    [],
  )
  const summaryVisibleWidgets = useMemo(
    () => visibleWidgets.filter((widget) => !evidenceWidgetSet.has(widget)),
    [evidenceWidgetSet, visibleWidgets],
  )
  const evidenceVisibleWidgets = useMemo(
    () => visibleWidgets.filter((widget) => evidenceWidgetSet.has(widget)),
    [evidenceWidgetSet, visibleWidgets],
  )
  const hiddenWidgets = useMemo(
    () => defaultWidgetOrder.filter((widget) => !widgetEnabled[widget]),
    [widgetEnabled],
  )

  const tileDeepLinks: Partial<Record<WidgetId, DashboardDeepLinkTarget>> = {
    today: { nav: 'Dashboard', anchorId: 'dashboard-time-analysis' },
    week: { nav: 'Dashboard', anchorId: 'dashboard-time-analysis' },
    month: { nav: 'Dashboard', anchorId: 'dashboard-time-analysis' },
    productivity: { nav: 'Dashboard', anchorId: 'dashboard-productivity-trend' },
    prediction: { nav: 'Insights', anchorId: 'insights-productivity-trend' },
    heatmap: { nav: 'Dashboard', anchorId: 'dashboard-study-heatmap' },
  }

  const activateDeepLink = (widget: WidgetId) => {
    const target = tileDeepLinks[widget]
    if (!target) return

    if (target.nav === 'Dashboard') {
      const didScroll = scrollToAnchor(target.anchorId)
      if (didScroll) {
        setHighlightedAnchorId(target.anchorId)
        window.setTimeout(() => setHighlightedAnchorId((current) => (current === target.anchorId ? null : current)), 1000)
      }
      return
    }

    onDeepLink?.(target)
  }

  useEffect(() => {
    if (!pendingAnchorId) return
    const didScroll = scrollToAnchor(pendingAnchorId)
    if (didScroll) {
      setHighlightedAnchorId(pendingAnchorId)
      window.setTimeout(() => setHighlightedAnchorId((current) => (current === pendingAnchorId ? null : current)), 1000)
      onPendingAnchorHandled?.()
    }
  }, [onPendingAnchorHandled, pendingAnchorId])

  const saveLayout = () => {
    window.localStorage.setItem(dashboardOrderStorageKey, JSON.stringify(widgetOrder))
    window.localStorage.setItem(dashboardEnabledStorageKey, JSON.stringify(widgetEnabled))
    setLayoutDirty(false)
    setCustomizeMode(false)
  }

  const resetLayout = () => {
    setWidgetOrder(defaultWidgetOrder)
    setWidgetEnabled(defaultWidgetEnabled)
    setLayoutDirty(true)
  }

  const moveWidget = (source: WidgetId, target: WidgetId) => {
    if (source === target) return
    setWidgetOrder((current) => {
      const sourceIndex = current.indexOf(source)
      const targetIndex = current.indexOf(target)
      if (sourceIndex === -1 || targetIndex === -1) return current
      const next = [...current]
      next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, source)
      return next
    })
    setLayoutDirty(true)
  }

  const addWidget = (widget: WidgetId) => {
    setWidgetEnabled((current) => ({ ...current, [widget]: true }))
    setLayoutDirty(true)
  }

  const removeWidget = (widget: WidgetId) => {
    const enabledCount = visibleWidgets.length
    if (enabledCount <= 1) return
    setWidgetEnabled((current) => ({ ...current, [widget]: false }))
    setLayoutDirty(true)
  }

  const widgetContent: Record<WidgetId, ReactNode> = {
    today: (
      <Tile
        title="📅 Today Minutes"
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
    ),
    week: (
      <Tile title="🗓️ Week Minutes" value={formatMinutes(metrics.weekMinutes)} description="Monday to today" icon={CalendarDays} />
    ),
    month: (
      <Tile title="📆 Month Minutes" value={formatMinutes(metrics.monthMinutes)} description="Current month total" icon={Goal} />
    ),
    streak: (
      <Tile
        title="🔥 Streak"
        value={`${streak?.currentStreak ?? 0} day${(streak?.currentStreak ?? 0) === 1 ? '' : 's'}`}
        description={`Longest: ${streak?.longestStreak ?? 0} • Missed: ${streak?.missedDays ?? 0}`}
        icon={Flame}
      />
    ),
    productivity: (
      <Tile
        title="⚡ Productivity"
        value={`${productivityQuery.data?.todayScore ?? 0}/100`}
        description={`Weekly avg: ${Math.round(productivityQuery.data?.weeklyAverage ?? 0)}`}
        icon={Goal}
        extra={
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-secondary">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${productivityQuery.data?.todayScore ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {productivityQuery.data?.explanation.summary ?? 'Productivity score updates from your sessions.'}
            </p>
          </div>
        }
      />
    ),
    prediction: (
      <Tile
        title="🔮 Tomorrow Prediction"
        value={formatMinutes(predictionQuery.data?.predictedMinutes ?? 0)}
        description={`Study probability: ${Math.round((predictionQuery.data?.studyProbability ?? 0) * 100)}%`}
        icon={Sparkles}
        extra={
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-secondary">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((predictionQuery.data?.studyProbability ?? 0) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Confidence {predictionQuery.data?.confidenceScore ?? 0}/100
            </p>
            <p className="text-xs text-muted-foreground">
              {predictionQuery.data?.explanation ?? 'Prediction adapts as your study pattern evolves.'}
            </p>
          </div>
        }
      />
    ),
    medals: (
      <Tile
        title="🏅 Medals"
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
    ),
    focusInsights: (
      <Card className="dashboard-widget h-full min-w-0 shadow-soft">
        <CardHeader>
          <CardTitle>🎯 Focus Insights</CardTitle>
          <CardDescription>
            Distractions in the last {distractionQuery.data?.days ?? 30} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">
              Most common: {distractionQuery.data?.mostCommon?.label ?? 'No data'}
            </Badge>
            <Badge variant="outline">
              Time lost: {distractionQuery.data?.totalMinutesLost ?? 0}m
            </Badge>
            <Badge variant="outline">
              Events: {distractionQuery.data?.totalEvents ?? 0}
            </Badge>
          </div>
          <div className="space-y-1">
            {(distractionQuery.data?.suggestions ?? ['Log distractions to unlock suggestions.']).map(
              (suggestion) => (
                <p key={suggestion} className="text-sm text-muted-foreground">
                  • {suggestion}
                </p>
              ),
            )}
          </div>
        </CardContent>
      </Card>
    ),
    heatmap: (
      <Card
        id="dashboard-study-heatmap"
        className={cn(
          'dashboard-widget h-full shadow-soft',
          highlightedAnchorId === 'dashboard-study-heatmap' &&
            'evidence-highlight-pulse ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>🟪 Study Heatmap</CardTitle>
              <CardDescription>
                GitHub-style year view. Hover cells for minutes and sessions.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                value={heatmapCourseId}
                onChange={(event) => setHeatmapCourseId(event.target.value)}
              >
                <option value="all">All courses</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                value={String(heatmapYear)}
                onChange={(event) => setHeatmapYear(Number(event.target.value))}
              >
                {availableYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-card to-secondary/40 p-4">
          {heatmap.weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No study data yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="relative min-w-[860px]">
                <div className="mb-2 grid grid-cols-12 gap-2 text-[11px] text-muted-foreground">
                  {heatmap.monthLabels.map((label) => (
                    <span key={`${label.month}-${label.column}`} style={{ gridColumn: `${Math.min(12, Math.floor((label.column / Math.max(1, heatmap.weeks.length)) * 12) + 1)}` }}>
                      {label.month}
                    </span>
                  ))}
                </div>
                <div className="grid grid-flow-col auto-cols-max gap-1">
                  {heatmap.weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="grid grid-rows-7 gap-1">
                    {week.map((day, dayIndex) => (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        title={`${day.date.toLocaleDateString()}: ${day.minutes} min, ${day.sessions} session${day.sessions === 1 ? '' : 's'}`}
                        className={cn(
                          'heatmap-cell h-3.5 w-3.5 rounded-[3px] transition-all hover:scale-125 hover:ring-1 hover:ring-ring/60',
                          day.inYear ? heatmapCellClass(day.minutes) : 'bg-transparent',
                        )}
                        style={{ animationDelay: `${(weekIndex * 7 + dayIndex) * 3}ms` }}
                      />
                    ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-muted/60" /> 0 min</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary/30" /> 1-29</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary/50" /> 30-59</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary/70" /> 60-119</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary/85" /> 120-179</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> 180+</span>
                <Badge variant="outline">Cutoff: {streak?.cutoffTime ?? '05:00'}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    ),
    trend: (
      <Card
        id="dashboard-productivity-trend"
        className={cn(
          'dashboard-widget h-full shadow-soft',
          highlightedAnchorId === 'dashboard-productivity-trend' &&
            'evidence-highlight-pulse ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <CardHeader>
          <CardTitle>📈 Weekly Productivity Trend</CardTitle>
          <CardDescription>
            Score drivers: target {productivityQuery.data?.explanation.targetCompletion ?? 0}, consistency{' '}
            {productivityQuery.data?.explanation.consistency ?? 0}, session length{' '}
            {productivityQuery.data?.explanation.sessionLength ?? 0}, breaks{' '}
            {productivityQuery.data?.explanation.breaks ?? 0}.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[220px] min-w-0">
          {productivityQuery.data?.weeklyTrend.length ? (
            <ResponsiveContainer width="100%" height={180} minWidth={0} minHeight={180}>
              <AreaChart data={productivityQuery.data.weeklyTrend}>
                <defs>
                  <linearGradient id="productivityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-glow))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--chart-glow))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => value.slice(5)}
                />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0]?.payload as
                      | {
                          score: number
                          actualMinutes: number
                          sessionsCount: number
                        }
                      | undefined
                    if (!row) return null
                    return (
                      <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-xs shadow-lg">
                        <p className="font-semibold text-foreground">{label}</p>
                        <p className="text-muted-foreground">Score: {row.score}/100</p>
                        <p className="text-muted-foreground">
                          {row.actualMinutes}m • {row.sessionsCount} session{row.sessionsCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    )
                  }}
                />
                <Area type="monotone" dataKey="score" stroke="hsl(var(--chart-1))" fill="url(#productivityFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground">No productivity trend yet.</p>
          )}
        </CardContent>
      </Card>
    ),
    courseChart: (
      <Card className="dashboard-widget h-full min-w-0 shadow-soft">
        <CardHeader>
          <CardTitle>📚 Minutes by Course</CardTitle>
          <CardDescription>Distribution of focused time across your subjects.</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px] min-w-0">
          {!hasData ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No sessions yet to visualize.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240} minWidth={0} minHeight={240}>
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
    ),
    timeAnalysis: (
      <Card
        id="dashboard-time-analysis"
        className={cn(
          'dashboard-widget h-full min-w-0 shadow-soft',
          highlightedAnchorId === 'dashboard-time-analysis' &&
            'evidence-highlight-pulse ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <CardHeader>
          <CardTitle>⏰ Time Analysis</CardTitle>
          <CardDescription>Minutes by day of week based on your logged sessions.</CardDescription>
        </CardHeader>
        <CardContent className="h-[320px] min-w-0">
          {!hasData ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No sessions yet to analyze.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240} minWidth={0} minHeight={240}>
              <BarChart data={metrics.weekChart} barCategoryGap={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${value}m`} tickLine={false} axisLine={false} width={46} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="minutes" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    ),
    atRisk: (
      <Card className="dashboard-widget h-full shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            At Risk
          </CardTitle>
          <CardDescription>Courses with elevated academic risk from grades, trend, study time, and upcoming deadlines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {riskItems.filter((item) => item.riskLevel !== 'low').slice(0, 4).length === 0 ? (
            <p className="text-sm text-muted-foreground">No high-risk courses right now.</p>
          ) : (
            riskItems
              .filter((item) => item.riskLevel !== 'low')
              .slice(0, 4)
              .map((item) => (
                <div key={item.courseId} className="rounded-md border border-border/70 bg-background/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.courseName}</p>
                    <Badge
                      variant={item.riskLevel === 'high' ? 'default' : 'secondary'}
                      className={item.riskLevel === 'high' ? 'bg-destructive/15 text-destructive' : undefined}
                    >
                      {item.riskLevel.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.reasons[0]}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addRiskToPlannerMutation.mutate({ courseId: item.courseId, minutes: item.recommendedMinutes })}
                      disabled={addRiskToPlannerMutation.isPending}
                    >
                      Add {item.recommendedMinutes}m this week
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => scheduleRevisionMutation.mutate({ courseId: item.courseId, courseName: item.courseName })}
                      disabled={scheduleRevisionMutation.isPending}
                    >
                      Schedule revision
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        createChecklistMutation.mutate({
                          courseId: item.courseId,
                          courseName: item.courseName,
                          actions: item.suggestedActions,
                        })
                      }
                      disabled={createChecklistMutation.isPending}
                    >
                      Create checklist
                    </Button>
                  </div>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    ),
  }

  return (
    <PageContainer>
      <PageHeader
        title={now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        subtitle={
          <span className="mt-1 inline-flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar week {isoWeekNumber(now)}
            </Badge>
            <Badge>{schoolLabel}</Badge>
          </span>
        }
        actions={(
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
        )}
      />

      <Card className="shadow-soft">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-primary" />
                Dashboard Layout
              </CardTitle>
              <CardDescription>Drag widgets, hide or add them, then save your layout.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={customizeMode ? 'secondary' : 'outline'} onClick={() => setCustomizeMode((current) => !current)}>
                {customizeMode ? 'Done editing' : 'Customize'}
              </Button>
              <Button
                variant="outline"
                onClick={resetLayout}
                disabled={!layoutDirty && JSON.stringify(widgetOrder) === JSON.stringify(defaultWidgetOrder)}
              >
                Reset
              </Button>
              <Button onClick={saveLayout} disabled={!layoutDirty}>
                <Save className="h-4 w-4" />
                Save layout
              </Button>
            </div>
          </div>
        </CardHeader>
        {customizeMode ? (
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Tip: drag widgets by dropping one card onto another card.</p>
            {hiddenWidgets.length === 0 ? (
              <p className="text-sm text-muted-foreground">All widgets are visible.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hiddenWidgets.map((widget) => (
                  <Button key={widget} variant="outline" size="sm" onClick={() => addWidget(widget)}>
                    <Plus className="h-3.5 w-3.5" />
                    {widgetLabel[widget]}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        ) : null}
      </Card>

      {customizeMode ? (
      <SectionGrid className="items-start gap-6 xl:grid-cols-4 2xl:grid-cols-4">
        {visibleWidgets.map((widget) => (
          <motion.div
            layout
            key={widget}
            className={cn(
              'relative',
              widgetLayoutClass[widget],
              !customizeMode && tileDeepLinks[widget] && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              customizeMode && 'rounded-xl ring-1 ring-dashed ring-primary/35',
            )}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            draggable={customizeMode}
            onDragStart={() => setDraggingWidget(widget)}
            onDragOver={(event) => {
              if (customizeMode) event.preventDefault()
            }}
            onDrop={() => {
              if (customizeMode && draggingWidget) {
                moveWidget(draggingWidget, widget)
                setDraggingWidget(null)
              }
            }}
            onDragEnd={() => setDraggingWidget(null)}
            role={!customizeMode && tileDeepLinks[widget] ? 'link' : undefined}
            tabIndex={!customizeMode && tileDeepLinks[widget] ? 0 : -1}
            onClick={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              const target = event.target as HTMLElement
              if (target.closest('button,select,input,textarea,a,[role="button"]')) return
              activateDeepLink(widget)
            }}
            onKeyDown={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activateDeepLink(widget)
              }
            }}
          >
            {customizeMode ? (
              <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <GripVertical className="h-3 w-3" />
                  Drag
                </Badge>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-6 w-6"
                  onClick={() => removeWidget(widget)}
                  disabled={visibleWidgets.length <= 1}
                  aria-label={`Remove ${widgetLabel[widget]}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}
            <div>{widgetContent[widget]}</div>
          </motion.div>
        ))}
      </SectionGrid>
      ) : (
      <div className="space-y-6">
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-4">
          {summaryVisibleWidgets.map((widget) => (
          <motion.div
            layout
            key={widget}
            className={cn(
              'relative',
              widget === 'focusInsights' ? 'md:col-span-2 xl:col-span-1' : 'col-span-1',
              !customizeMode && tileDeepLinks[widget] && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            draggable={customizeMode}
            onDragStart={() => setDraggingWidget(widget)}
            onDragOver={(event) => {
              if (customizeMode) event.preventDefault()
            }}
            onDrop={() => {
              if (customizeMode && draggingWidget) {
                moveWidget(draggingWidget, widget)
                setDraggingWidget(null)
              }
            }}
            onDragEnd={() => setDraggingWidget(null)}
            role={!customizeMode && tileDeepLinks[widget] ? 'link' : undefined}
            tabIndex={!customizeMode && tileDeepLinks[widget] ? 0 : -1}
            onClick={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              const target = event.target as HTMLElement
              if (target.closest('button,select,input,textarea,a,[role="button"]')) return
              activateDeepLink(widget)
            }}
            onKeyDown={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activateDeepLink(widget)
              }
            }}
          >
            <div>{widgetContent[widget]}</div>
          </motion.div>
        ))}
        </div>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          {evidenceVisibleWidgets.map((widget) => (
          <motion.div
            layout
            key={widget}
            className={cn(
              'relative',
              widget === 'heatmap' ? 'xl:col-span-2' : 'col-span-1',
              !customizeMode && tileDeepLinks[widget] && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            draggable={customizeMode}
            onDragStart={() => setDraggingWidget(widget)}
            onDragOver={(event) => {
              if (customizeMode) event.preventDefault()
            }}
            onDrop={() => {
              if (customizeMode && draggingWidget) {
                moveWidget(draggingWidget, widget)
                setDraggingWidget(null)
              }
            }}
            onDragEnd={() => setDraggingWidget(null)}
            role={!customizeMode && tileDeepLinks[widget] ? 'link' : undefined}
            tabIndex={!customizeMode && tileDeepLinks[widget] ? 0 : -1}
            onClick={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              const target = event.target as HTMLElement
              if (target.closest('button,select,input,textarea,a,[role="button"]')) return
              activateDeepLink(widget)
            }}
            onKeyDown={(event) => {
              if (customizeMode || !tileDeepLinks[widget]) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activateDeepLink(widget)
              }
            }}
          >
            <div>{widgetContent[widget]}</div>
          </motion.div>
        ))}
        </div>
      </div>
      )}
    </PageContainer>
  )
}
