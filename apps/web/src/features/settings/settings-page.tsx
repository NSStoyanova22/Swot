import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  Palette,
  RefreshCcw,
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
import { useFocusSoundPreferences } from '@/hooks/use-focus-sound-preferences'
import { useHealthQuery } from '@/hooks/use-health-query'
import { useSessionSync } from '@/hooks/use-session-sync'
import { useUiPersonalization } from '@/hooks/use-ui-personalization'
import { type ThemeName, useTheme } from '@/hooks/use-theme'

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
    adaptiveEnabled: true,
  },
  targets: weekdayOrder.map(({ weekday }) => ({ weekday, targetMinutes: 90 })),
  uiPreferences: {
    workspaceName: 'Study Hub',
    avatar: '✨',
    accentColor: '#e11d77',
    dashboardBackground:
      'radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)',
    themePreset: 'pink',
    widgetStyle: 'soft',
    layoutDensity: 'comfortable',
  },
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
      adaptiveEnabled: settings?.adaptiveEnabled ?? true,
    },
    targets: weekdayOrder.map(({ weekday }) => ({
      weekday,
      targetMinutes: targetsByWeekday.get(weekday) ?? 90,
    })),
    uiPreferences: meData.uiPreferences ?? defaultForm.uiPreferences,
  }
}

export function SettingsPage() {
  const { toast } = useToast()
  const { preferences: soundPrefs, updatePreferences: updateSoundPrefs } = useFocusSoundPreferences()
  const sync = useSessionSync()
  const { theme, setTheme, options: themeOptions } = useTheme()
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
  const [downloadingReport, setDownloadingReport] = useState(false)
  useUiPersonalization({
    workspaceName: form.uiPreferences?.workspaceName ?? 'Swot',
    avatar: form.uiPreferences?.avatar ?? '✨',
    accentColor: form.uiPreferences?.accentColor ?? '#1f1b1d',
    dashboardBackground:
      form.uiPreferences?.dashboardBackground ??
      'radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)',
    themePreset: form.uiPreferences?.themePreset ?? 'pink',
    widgetStyle: form.uiPreferences?.widgetStyle ?? 'soft',
    layoutDensity: form.uiPreferences?.layoutDensity ?? 'comfortable',
  })

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
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['productivity'] })
      queryClient.invalidateQueries({ queryKey: ['timer-recommendation'] })
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

  const syncLabel = sync.isSyncing
    ? `Syncing ${sync.pendingCount} queued`
    : sync.pendingCount > 0
      ? `${sync.pendingCount} queued`
      : 'Up to date'

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
    if (form.uiPreferences?.themePreset) {
      setTheme(form.uiPreferences.themePreset as ThemeName)
    }
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

  const handleDownloadReport = async () => {
    const base = import.meta.env.VITE_API_URL.endsWith('/')
      ? import.meta.env.VITE_API_URL.slice(0, -1)
      : import.meta.env.VITE_API_URL
    const url = `${base}/reports/study.pdf`

    setDownloadingReport(true)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Report request failed (${response.status})`)
      }
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'swot-study-report.pdf'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(downloadUrl)

      toast({
        variant: 'success',
        title: 'Report ready',
        description: 'Study report PDF downloaded successfully.',
      })
    } catch {
      toast({
        variant: 'error',
        title: 'Download failed',
        description: 'Could not generate study report right now.',
      })
    } finally {
      setDownloadingReport(false)
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
            ⚙️ Study Preferences
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
            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="text-sm font-semibold">Adaptive Pomodoro</p>
              <button
                type="button"
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      adaptiveEnabled: !(current.settings.adaptiveEnabled ?? true),
                    },
                  }))
                }
              >
                {(form.settings.adaptiveEnabled ?? true) ? (
                  <>
                    <Check className="h-4 w-4 text-primary" /> Enabled
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" /> Disabled
                  </>
                )}
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                Automatically adjusts focus duration based on recent completion and break patterns.
              </p>
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

          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-sm font-semibold">Study Report</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Download a full PDF report with totals, streak stats, course breakdown, charts, and recent sessions.
            </p>
            <div className="mt-3">
              <Button onClick={handleDownloadReport} disabled={downloadingReport}>
                <FileDown className="h-4 w-4" />
                {downloadingReport ? 'Generating report...' : 'Download Study Report'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Theme Engine</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Choose and preview themes. Selection is saved locally.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-lg border p-3 text-left transition ${
                    theme === option.value
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border/70 bg-background hover:border-primary/30'
                  }`}
                  onClick={() => setTheme(option.value as ThemeName)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{option.label}</p>
                    {theme === option.value ? <Check className="h-4 w-4 text-primary" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-sm font-semibold">Personalization Studio</p>
            <p className="mt-1 text-xs text-muted-foreground">Live preview with accent, avatar, workspace, widget style, and density.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Workspace name</span>
                <Input
                  value={form.uiPreferences?.workspaceName ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        workspaceName: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Avatar</span>
                <Input
                  value={form.uiPreferences?.avatar ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        avatar: event.target.value.slice(0, 8),
                      },
                    }))
                  }
                  placeholder="✨"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Accent color</span>
                <Input
                  type="color"
                  value={form.uiPreferences?.accentColor ?? '#e11d77'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        accentColor: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Theme preset</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.uiPreferences?.themePreset ?? 'pink'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        themePreset: event.target.value as ThemeName,
                      },
                    }))
                  }
                >
                  {themeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Widget style</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.uiPreferences?.widgetStyle ?? 'soft'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        widgetStyle: event.target.value as 'soft' | 'glass' | 'flat',
                      },
                    }))
                  }
                >
                  <option value="soft">Soft</option>
                  <option value="glass">Glass</option>
                  <option value="flat">Flat</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Layout density</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.uiPreferences?.layoutDensity ?? 'comfortable'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      uiPreferences: {
                        ...current.uiPreferences,
                        layoutDensity: event.target.value as 'comfortable' | 'compact' | 'cozy',
                      },
                    }))
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="cozy">Cozy</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Custom dashboard background</span>
              <Input
                value={form.uiPreferences?.dashboardBackground ?? ''}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    uiPreferences: {
                      ...current.uiPreferences,
                      dashboardBackground: event.target.value,
                    },
                  }))
                }
              />
            </label>
            <div className="mt-3 rounded-lg border border-border/70 p-3" style={{ backgroundImage: form.uiPreferences?.dashboardBackground }}>
              <p className="text-sm font-semibold">
                {form.uiPreferences?.avatar} {form.uiPreferences?.workspaceName}
              </p>
              <p className="text-xs text-muted-foreground">Live preview of your personal workspace identity.</p>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70 p-3">
            <p className="text-sm font-semibold">Focus Sounds Defaults</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This saves your last selected sound for the Timer page.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Default sound</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={soundPrefs.selectedSound}
                  onChange={(event) =>
                    updateSoundPrefs({
                      selectedSound: event.target.value as
                        | 'white'
                        | 'rain'
                        | 'cafe'
                        | 'brown'
                        | 'youtube',
                    })
                  }
                >
                  <option value="white">🤍 White noise</option>
                  <option value="rain">🌧️ Rain</option>
                  <option value="cafe">☕ Cafe ambience</option>
                  <option value="brown">🟤 Brown noise</option>
                  <option value="youtube">🎧 YouTube lo-fi</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Default volume</span>
                <Input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={soundPrefs.volume}
                  onChange={(event) => updateSoundPrefs({ volume: Number(event.target.value) })}
                />
                <p className="text-xs text-muted-foreground">{Math.round(soundPrefs.volume * 100)}%</p>
              </label>
            </div>
            <label className="mt-3 block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">YouTube embed URL (optional)</span>
              <Input
                value={soundPrefs.youtubeUrl}
                onChange={(event) => updateSoundPrefs({ youtubeUrl: event.target.value })}
                placeholder="https://www.youtube.com/embed/jfKfPfyJRdk"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Status</CardTitle>
          <CardDescription>Connection and sync health for settings persistence.</CardDescription>
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
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/80 p-3">
            <div className="flex items-center gap-2">
              {sync.isSyncing ? <RefreshCcw className="h-4 w-4 animate-spin text-primary" /> : <Clock3 className="h-4 w-4 text-primary" />}
              <p className="text-sm font-medium">Session Sync</p>
            </div>
            <Badge variant={sync.pendingCount > 0 ? 'secondary' : 'outline'}>{syncLabel}</Badge>
          </div>
          {sync.lastError ? <p className="text-xs text-muted-foreground">Last sync notice: {sync.lastError}</p> : null}
          <Button variant="outline" onClick={() => sync.syncNow()} disabled={sync.isSyncing}>
            {sync.isSyncing ? 'Syncing...' : 'Sync now'}
          </Button>
          <Button variant="outline" onClick={() => health.refetch()} disabled={health.isFetching}>
            {health.isFetching ? 'Refreshing...' : 'Refresh status'}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
