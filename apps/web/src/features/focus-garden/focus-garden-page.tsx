import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Flower2, Leaf, Sparkles, Sprout, Trees } from 'lucide-react'

import { getFocusGardenOverview } from '@/api/focus-garden'
import type { FocusGardenTimelineItemDto } from '@/api/dtos'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function formatDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function stemColorByType(type: string) {
  if (type === 'tree') return '#8B5A2B'
  if (type === 'shrub') return '#a16207'
  return '#9f1239'
}

function blossomColorByType(type: string) {
  if (type === 'tree') return '#e11d77'
  if (type === 'shrub') return '#ec4899'
  if (type === 'flower') return '#f472b6'
  return '#fb7185'
}

function PlantGlyph({
  item,
  x,
  depth,
  index,
}: {
  item: FocusGardenTimelineItemDto
  x: number
  depth: number
  index: number
}) {
  const height = Math.max(14, Math.min(58, Math.round(item.growthPoints * 0.28)))
  const baseY = 104 - depth
  const stemColor = stemColorByType(item.plantType)
  const bloomColor = blossomColorByType(item.plantType)

  const crown = item.plantType === 'tree'
    ? <circle cx={x} cy={baseY - height} r={Math.max(8, Math.round(height * 0.33))} fill={bloomColor} fillOpacity={0.8} />
    : item.plantType === 'shrub'
      ? <ellipse cx={x} cy={baseY - height} rx={Math.max(7, Math.round(height * 0.28))} ry={Math.max(5, Math.round(height * 0.2))} fill={bloomColor} fillOpacity={0.75} />
      : item.plantType === 'flower'
        ? (
            <>
              <circle cx={x} cy={baseY - height} r={5} fill={bloomColor} fillOpacity={0.8} />
              <circle cx={x - 4} cy={baseY - height - 1} r={3} fill="#f9a8d4" fillOpacity={0.75} />
              <circle cx={x + 4} cy={baseY - height - 1} r={3} fill="#f9a8d4" fillOpacity={0.75} />
            </>
          )
        : <circle cx={x} cy={baseY - height} r={3.5} fill={bloomColor} fillOpacity={0.8} />

  return (
    <motion.g
      initial={{ opacity: 0, scaleY: 0.2, y: 8 }}
      animate={{ opacity: 1, scaleY: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.025, 0.7), ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: `${x}px ${baseY}px` }}
    >
      <line x1={x} y1={baseY} x2={x} y2={baseY - height} stroke={stemColor} strokeWidth={2.2} strokeLinecap="round" />
      <ellipse cx={x - 4} cy={baseY - Math.round(height * 0.55)} rx={4} ry={2.2} fill="#fda4af" fillOpacity={0.75} transform={`rotate(-24 ${x - 4} ${baseY - Math.round(height * 0.55)})`} />
      <ellipse cx={x + 4} cy={baseY - Math.round(height * 0.4)} rx={4} ry={2.2} fill="#f9a8d4" fillOpacity={0.75} transform={`rotate(24 ${x + 4} ${baseY - Math.round(height * 0.4)})`} />
      {crown}
    </motion.g>
  )
}

export function FocusGardenPage() {
  const gardenQuery = useQuery({
    queryKey: ['focus-garden-overview'],
    queryFn: ({ signal }) => getFocusGardenOverview({ days: 90, timelineLimit: 120 }, signal),
    staleTime: 2 * 60 * 1000,
  })

  if (gardenQuery.isPending) {
    return (
      <section className="space-y-4">
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full rounded-xl" />
          </CardContent>
        </Card>
      </section>
    )
  }

  if (gardenQuery.isError || !gardenQuery.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Could not load Focus Garden right now.
      </div>
    )
  }

  const overview = gardenQuery.data
  const recentPlants = overview.timeline.slice(0, 48).reverse()
  const last14 = overview.daily.slice(-14)
  const bestDay = overview.daily.reduce(
    (best, day) => (day.growthPoints > best.growthPoints ? day : best),
    overview.daily[0] ?? null,
  )
  const rewardText =
    overview.summary.consistencyStreak >= 7
      ? 'Your garden is thriving. Keep this rhythm.'
      : overview.summary.consistencyStreak >= 3
        ? 'Steady momentum. A few more days will unlock bigger growth.'
        : 'Start with one focused session today and your garden will bloom.'

  return (
    <section className="space-y-4">
      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flower2 className="h-4 w-4 text-primary" />
            Focus Garden
          </CardTitle>
          <CardDescription>Each completed focus session grows a living part of your study garden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Plants</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{overview.summary.totalPlants}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Growth Points</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{overview.summary.totalGrowthPoints}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Consistency</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{overview.summary.consistencyStreak}d</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Garden Level</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">Lv {overview.summary.gardenLevel}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-rose-50 via-pink-50 to-rose-100 p-3 shadow-inner dark:from-rose-950/30 dark:via-pink-950/20 dark:to-rose-900/20">
            <svg viewBox="0 0 1000 320" className="h-[300px] w-full rounded-xl" role="img" aria-label="Focus garden growth visualization">
              <defs>
                <linearGradient id="gardenSky" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffe4ec" />
                  <stop offset="100%" stopColor="#fff1f5" />
                </linearGradient>
                <linearGradient id="gardenGround" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#fecdd3" />
                  <stop offset="100%" stopColor="#fda4af" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width="1000" height="320" fill="url(#gardenSky)" rx="18" />
              <ellipse cx="500" cy="272" rx="460" ry="84" fill="url(#gardenGround)" fillOpacity={0.5} />
              <line x1="40" y1="244" x2="960" y2="244" stroke="#f9a8d4" strokeWidth="2" strokeOpacity={0.65} />

              {recentPlants.map((item, index) => {
                const seed = hashString(item.id)
                const column = index % 16
                const row = Math.floor(index / 16)
                const xBase = 76 + column * 56
                const x = xBase + (seed % 13) - 6
                const depth = row * 8 + (seed % 3)
                return <PlantGlyph key={item.id} item={item} x={x} depth={depth} index={index} />
              })}
            </svg>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/80 p-3">
            <p className="text-sm text-muted-foreground">{rewardText}</p>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Daily Growth
            </CardTitle>
            <CardDescription>Last 14 days of plant growth from completed sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 overflow-x-auto rounded-xl border border-border/60 bg-background/60 p-3">
              {last14.map((day) => {
                const max = Math.max(...last14.map((item) => item.growthPoints), 1)
                const height = Math.max(10, Math.round((day.growthPoints / max) * 110))
                return (
                  <div key={day.date} className="min-w-8 text-center">
                    <motion.div
                      initial={{ height: 10, opacity: 0.6 }}
                      animate={{ height, opacity: 1 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className={cn(
                        'mx-auto w-6 rounded-t-md bg-primary/70',
                        day.hasGrowth ? 'shadow-[0_0_0_1px_rgba(225,29,119,0.15)]' : 'bg-muted',
                      )}
                    />
                    <p className="mt-2 text-[10px] text-muted-foreground">{formatDateLabel(day.date)}</p>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="gap-1"><Leaf className="h-3 w-3" /> Sessions grow plants</Badge>
              <Badge variant="outline" className="gap-1"><Sprout className="h-3 w-3" /> Longer sessions = bigger growth</Badge>
              {bestDay ? <Badge variant="secondary">Best day: {formatDateLabel(bestDay.date)} ({bestDay.growthPoints} pts)</Badge> : null}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              Growth Timeline
            </CardTitle>
            <CardDescription>Most recent planted sessions.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
            {overview.timeline.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 bg-background/70 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{item.courseName}</p>
                  <Badge variant="secondary" className="gap-1">
                    <Trees className="h-3 w-3" />
                    +{item.growthPoints}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.sessionMinutes}m · {new Date(item.grewAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.plantType} · {item.growthStage}
                </p>
              </div>
            ))}
            {overview.timeline.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No plants yet. Complete a focus session to start your garden.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </section>
  )
}
