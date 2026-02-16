import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Clock3, Coffee, Lock, Sparkles, Target } from 'lucide-react'

import { getAnalyticsInsights } from '@/api/analytics'
import { PageContainer, PageHeader, SectionGrid } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function formatMinutes(value: number) {
  if (value < 60) return `${Math.round(value)}m`
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground">{payload[0]?.value ?? 0}</p>
    </div>
  )
}

function shortenHourRangeLabel(label: string) {
  const normalized = label.toLowerCase()
  if (normalized.includes('morning')) return 'Morning'
  if (normalized.includes('noon') || normalized.includes('midday')) return 'Noon'
  if (normalized.includes('evening')) return 'Eve'
  if (normalized.includes('night')) return 'Night'
  return label
}

export function InsightsPage() {
  const [isCompact, setIsCompact] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)')
    const onChange = () => setIsCompact(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const insightsQuery = useQuery({
    queryKey: ['analytics-insights'],
    queryFn: ({ signal }) => getAnalyticsInsights(signal),
    staleTime: 5 * 60 * 1000,
  })

  if (insightsQuery.isPending) {
    return (
      <PageContainer>
        <SectionGrid className="xl:[&>*]:col-span-1">
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
        </SectionGrid>
      </PageContainer>
    )
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load insights right now.
        </div>
      </PageContainer>
    )
  }

  const insights = insightsQuery.data

  if (!insights.unlocked) {
    const remaining = Math.max(0, 5 - insights.sessionCount)

    return (
      <PageContainer>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Lock className="h-4 w-4 text-primary" />
              🔒 Insights Locked
            </span>
          }
          subtitle="Log a few more sessions and we will unlock your personalized learning patterns."
        />
        <Card className="mx-auto w-full max-w-2xl shadow-soft">
          <CardContent className="space-y-3 pt-6 text-sm">
            <p>
              You have <span className="font-semibold">{insights.sessionCount}</span> session(s). Add{' '}
              <span className="font-semibold">{remaining}</span> more to unlock Insights.
            </p>
            <div className="h-2 rounded-full bg-secondary">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (insights.sessionCount / 5) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="📊 Insights"
        subtitle="Personalized study patterns, trend signals, and recommendations."
        actions={<Badge variant="outline">{insights.sessionCount} sessions analyzed</Badge>}
      />

      <SectionGrid className="xl:[&>*]:col-span-1">
        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Best Day
              <Target className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.bestStudyWeekday?.label ?? '-'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Most minutes: {formatMinutes(insights.bestStudyWeekday?.minutes ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Best Hour Range
              <Clock3 className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.bestStudyHourRange?.label ?? '-'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Most minutes: {formatMinutes(insights.bestStudyHourRange?.minutes ?? 0)}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Avg Session
              <Sparkles className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{formatMinutes(insights.averageSessionDurationMinutes)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Across {insights.sessionCount} sessions</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Consistency
              <Target className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle>{insights.consistencyScore}/100</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Daily rhythm stability score</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              Burnout Risk
              <AlertTriangle className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle className={cn(insights.burnoutRisk.level === 'high' && 'text-destructive')}>
              {insights.burnoutRisk.level.toUpperCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Score: {insights.burnoutRisk.score}/100</p>
          </CardContent>
        </Card>
      </SectionGrid>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle>💡 AI-style Recommendations</CardTitle>
          <CardDescription>{insights.explanation}</CardDescription>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              Break every {insights.recommendedBreakFrequencyMinutes} min
            </Badge>
            <Badge variant="outline">
              Burnout: {insights.burnoutRisk.level}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {insights.recommendations.map((item) => (
            <p key={item} className="text-sm text-muted-foreground">
              • {item}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">Why: {insights.burnoutRisk.reason}</p>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>📈 Minutes by Weekday</CardTitle>
            <CardDescription>Your strongest weekday pattern.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <BarChart data={insights.charts.weekdayMinutes} barCategoryGap={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value) => `${value}m`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="minutes" fill="hsl(var(--chart-1))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle>⏰ Minutes by Hour Range</CardTitle>
            <CardDescription>When your focus tends to peak.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <BarChart
                data={insights.charts.hourRangeMinutes}
                barCategoryGap={18}
                margin={{ top: 8, right: 8, left: 4, bottom: isCompact ? 40 : 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis
                  dataKey="range"
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(value: string) => (isCompact ? shortenHourRangeLabel(value) : value)}
                  angle={isCompact ? -25 : 0}
                  textAnchor={isCompact ? 'end' : 'middle'}
                  height={isCompact ? 52 : 30}
                  fontSize={11}
                />
                <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value) => `${value}m`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="minutes" fill="hsl(var(--chart-2))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coffee className="h-4 w-4 text-primary" />
            ☕ Session & Productivity Trend
          </CardTitle>
          <CardDescription>Trend lines used for burnout analysis.</CardDescription>
        </CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <LineChart data={insights.charts.productivityTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(value) => value.slice(5)} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={40} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
