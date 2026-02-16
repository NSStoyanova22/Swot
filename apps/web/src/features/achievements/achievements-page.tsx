import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Award,
  BookOpenCheck,
  CalendarCheck,
  Flame,
  GraduationCap,
  Lock,
  Medal,
  Moon,
  Sparkles,
  Sunrise,
  Target,
  Zap,
} from 'lucide-react'

import { getAchievements } from '@/api/achievements'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const iconMap = {
  flame: Flame,
  sunrise: Sunrise,
  moon: Moon,
  zap: Zap,
  target: Target,
  'calendar-check': CalendarCheck,
  'book-open-check': BookOpenCheck,
  'graduation-cap': GraduationCap,
} as const

export function AchievementsPage() {
  const achievementsQuery = useQuery({
    queryKey: ['achievements'],
    queryFn: ({ signal }) => getAchievements(signal),
  })

  const data = achievementsQuery.data

  const earnedCount = useMemo(() => {
    if (!data) return 0
    return data.achievements.filter((achievement) => achievement.earned).length
  }, [data])

  if (achievementsQuery.isPending) {
    return (
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index} className="shadow-soft">
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </section>
    )
  }

  if (achievementsQuery.isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Could not load achievements right now.
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="shadow-soft lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />
              Achievements
            </CardTitle>
            <CardDescription>Progress-based badges, unlocked once unless they are level-based.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold">{earnedCount}</p>
              <p className="text-sm text-muted-foreground">Earned badges</p>
            </div>
            <Badge>{data.achievements.length} total</Badge>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base">Daily Medals</CardTitle>
            <CardDescription>Based on total focused minutes per day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Gold: {data.medals.gold}</p>
            <p>Silver: {data.medals.silver}</p>
            <p>Bronze: {data.medals.bronze}</p>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-base">Thresholds</CardTitle>
            <CardDescription>Minutes required in one day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Gold: {data.medalThresholds.gold}m+</p>
            <p>Silver: {data.medalThresholds.silver}m+</p>
            <p>Bronze: {data.medalThresholds.bronze}m+</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.achievements.map((achievement) => {
          const Icon = iconMap[achievement.icon as keyof typeof iconMap] ?? Sparkles

          return (
            <Card
              key={achievement.code}
              className={cn(
                'transition-colors',
                achievement.earned
                  ? 'border-primary/40 bg-primary/5 shadow-soft'
                  : 'border-border/70 bg-background/70 opacity-75',
              )}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="inline-flex items-center gap-2">
                    <Icon className={cn('h-4 w-4', achievement.earned ? 'text-primary' : 'text-muted-foreground')} />
                    {achievement.title}
                  </span>
                  {achievement.earned ? <Medal className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
                <CardDescription>{achievement.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {achievement.earned ? (
                  <div className="space-y-1">
                    <p>
                      Earned: {achievement.earnedAt ? new Date(achievement.earnedAt).toLocaleDateString() : 'Yes'}
                    </p>
                    {achievement.level ? <p>Level: {achievement.level}</p> : null}
                  </div>
                ) : (
                  <p>Locked</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
