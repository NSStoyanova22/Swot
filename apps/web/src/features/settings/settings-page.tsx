import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Save,
  Settings2,
  TriangleAlert,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react'

import { getMe, updatePreferences } from '@/api/me'
import type { UpdatePreferencesDto } from '@/api/dtos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useHealthQuery } from '@/hooks/use-health-query'

const weekdayOrder: Array<{ day: string; weekday: number }> = [
  { day: 'Mon', weekday: 1 },
  { day: 'Tue', weekday: 2 },
  { day: 'Wed', weekday: 3 },
  { day: 'Thu', weekday: 4 },
  { day: 'Fri', weekday: 5 },
  { day: 'Sat', weekday: 6 },
  { day: 'Sun', weekday: 7 },
]

const defaultForm: UpdatePreferencesDto = {
  settings: {
    cutoffTime: '05:00',
    soundsEnabled: true,
    shortSessionMinutes: 10,
    longSessionMinutes: 50,
    breakSessionMinutes: 25,
  },
  targets: weekdayOrder.map(({ weekday }) => ({ weekday, targetMinutes: 90 })),
}

function createFormFromMe(meData: Awaited<ReturnType<typeof getMe>>): UpdatePreferencesDto {
  const settings = meData.settings
  const targetsByWeekday = new Map(meData.targets.map((target) => [target.weekday, target.targetMinutes]))

  return {
    settings: {
      cutoffTime: settings?.cutoffTime ?? '05:00',
      soundsEnabled: settings?.soundsEnabled ?? true,
      shortSessionMinutes: settings?.shortSessionMinutes ?? 10,
      breakSessionMinutes: settings?.breakSessionMinutes ?? 25,
      longSessionMinutes: settings?.longSessionMinutes ?? 50,
    },
    targets: weekdayOrder.map(({ weekday }) => ({
      weekday,
      targetMinutes: targetsByWeekday.get(weekday) ?? 90,
    })),
  }
}

export function SettingsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
  })
  const health = useHealthQuery(true)

  const [form, setForm] = useState<UpdatePreferencesDto>(defaultForm)
  const [isInitialized, setIsInitialized] = useState(false)
  const [showCalendarLink, setShowCalendarLink] = useState(false)
  const [copied, setCopied] = useState(false)

  const calendarFeedUrl = useMemo(() => {
    const base = import.meta.env.VITE_API_URL.endsWith('/')
      ? import.meta.env.VITE_API_URL.slice(0, -1)
      : import.meta.env.VITE_API_URL
    return `${base}/calendar.ics`
  }, [])

  useEffect(() => {
    if (!meQuery.data) return
    if (!isInitialized) {
      setForm(createFormFromMe(meQuery.data))
      setIsInitialized(true)
    }
  }, [isInitialized, meQuery.data])

  const mutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated)
      setForm(createFormFromMe(updated))
      toast({
        variant: 'success',
        title: 'Settings saved',
        description: 'Your preferences were updated successfully.',
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Save failed',
        description: 'Could not save preferences. Please try again.',
      })
    },
  })

  const validationError = useMemo(() => {
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!timePattern.test(form.settings.cutoffTime)) {
      return 'Cutoff time must be in HH:MM format.'
    }

    const durations = [
      form.settings.shortSessionMinutes,
      form.settings.breakSessionMinutes,
      form.settings.longSessionMinutes,
    ]

    const invalidDuration = durations.some((value) => !Number.isFinite(value) || value <= 0)
    if (invalidDuration) {
      return 'Default session durations must be positive minutes.'
    }

    const invalidTarget = form.targets.some((item) => !Number.isFinite(item.targetMinutes) || item.targetMinutes < 0)
    if (invalidTarget) {
      return 'Daily targets must be 0 or greater.'
    }

    return null
  }, [form])

  const status = useMemo(() => {
    if (health.isPending) {
      return { label: 'Checking...', tone: 'outline' as const, icon: Clock3 }
    }

    if (health.isError || !health.data?.ok) {
      return { label: 'Offline', tone: 'secondary' as const, icon: WifiOff }
    }

    return { label: 'Online', tone: 'default' as const, icon: CheckCircle2 }
  }, [health.data?.ok, health.isError, health.isPending])

  const applyPreset = () => {
    setForm((current) => ({
      ...current,
      settings: {
        ...current.settings,
        shortSessionMinutes: 10,
        breakSessionMinutes: 25,
        longSessionMinutes: 50,
      },
    }))
  }

  const handleSave = () => {
    if (validationError) return
    mutation.mutate(form)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      toast({
        variant: 'success',
        title: 'Link copied',
        description: 'Calendar feed URL copied to clipboard.',
      })
    } catch {
      setCopied(false)
      toast({
        variant: 'error',
        title: 'Copy failed',
        description: 'Clipboard permission denied. Copy manually from the field.',
      })
    }
  }

  if (meQuery.isPending) {
    return (
      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
        <Card className="shadow-soft">
          <CardHeader>
            <Skeleton className="h-6 w-28" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </section>
    )
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Could not load settings. Verify backend is running and refresh.
      </div>
    )
  }

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2 shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Study Preferences
          </CardTitle>
          <CardDescription>Configure targets, day cutoff, default duration buttons, and audio behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Daily Targets (minutes)</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {weekdayOrder.map(({ day, weekday }) => {
                const value = form.targets.find((item) => item.weekday === weekday)?.targetMinutes ?? 0

                return (
                  <label key={weekday} className="space-y-1.5 rounded-lg border border-border/70 bg-background/70 p-3">
                    <span className="text-xs font-medium text-muted-foreground">{day}</span>
                    <Input
                      type="number"
                      min={0}
                      value={value}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value)
                        setForm((current) => ({
                          ...current,
                          targets: current.targets.map((target) =>
                            target.weekday === weekday
                              ? {
                                  ...target,
                                  targetMinutes: Number.isNaN(nextValue) ? 0 : nextValue,
                                }
                              : target,
                          ),
                        }))
                      }}
                    />
                  </label>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-semibold">Study Day Cutoff Time</span>
              <Input
                type="time"
                value={form.settings.cutoffTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    settings: { ...current.settings, cutoffTime: event.target.value },
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">Example: 05:00 means the study day starts at 5 AM.</p>
            </label>

            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-sm font-semibold">Sound Effects</p>
              <button
                type="button"
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    settings: { ...current.settings, soundsEnabled: !current.settings.soundsEnabled },
                  }))
                }
              >
                {form.settings.soundsEnabled ? (
                  <>
                    <Volume2 className="h-4 w-4 text-primary" /> Enabled
                  </>
                ) : (
                  <>
                    <VolumeX className="h-4 w-4 text-muted-foreground" /> Disabled
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Default Session Duration Buttons</h3>
              <Button variant="outline" onClick={applyPreset}>Use 10 / 25 / 50</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Button 1 (min)</span>
                <Input
                  type="number"
                  min={1}
                  value={form.settings.shortSessionMinutes}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        shortSessionMinutes: Number.isNaN(value) ? 0 : value,
                      },
                    }))
                  }}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Button 2 (min)</span>
                <Input
                  type="number"
                  min={1}
                  value={form.settings.breakSessionMinutes}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        breakSessionMinutes: Number.isNaN(value) ? 0 : value,
                      },
                    }))
                  }}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Button 3 (min)</span>
                <Input
                  type="number"
                  min={1}
                  value={form.settings.longSessionMinutes}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        longSessionMinutes: Number.isNaN(value) ? 0 : value,
                      },
                    }))
                  }}
                />
              </label>
            </div>
          </div>

          {validationError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4" />
              <p>{validationError}</p>
            </div>
          ) : null}

          {mutation.isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4" />
              <p>Could not save preferences. Please try again.</p>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleSave} disabled={Boolean(validationError) || mutation.isPending}>
              <Save className="h-4 w-4" />
              {mutation.isPending ? 'Saving...' : 'Save settings'}
            </Button>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-sm font-semibold">Calendar Feed Export (.ics)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Subscribe in Google Calendar, Apple Calendar, or Outlook using this link.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCalendarLink(true)}
              >
                Generate link
              </Button>
              {showCalendarLink ? (
                <>
                  <Input value={calendarFeedUrl} readOnly className="min-w-[280px] flex-1" />
                  <Button variant="secondary" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy URL'}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Status</CardTitle>
          <CardDescription>Connection health for settings persistence.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/80 p-3">
            <div className="flex items-center gap-2">
              <status.icon className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">Service</p>
            </div>
            <Badge variant={status.tone}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            API URL: <span className="font-medium text-foreground">{import.meta.env.VITE_API_URL}</span>
          </p>
          <Button variant="outline" onClick={() => health.refetch()} disabled={health.isFetching}>
            {health.isFetching ? 'Refreshing...' : 'Refresh status'}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
