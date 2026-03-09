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
import { getSessionSyncState } from '@/api/sessions'
import { ApiError } from '@/api/client'
import type { UpdatePreferencesDto } from '@/api/dtos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { useFocusSoundPreferences } from '@/hooks/use-focus-sound-preferences'
import { useHealthQuery } from '@/hooks/use-health-query'
import { useSessionSync } from '@/hooks/use-session-sync'
import { useUiPersonalization } from '@/hooks/use-ui-personalization'
import { type ThemeName, useTheme } from '@/hooks/use-theme'
import { SettingsCard } from '@/features/settings/settings-card'
import { generateAccentShades, normalizeHexColor } from '@/theme/accent'
import { normalizeTheme } from '@/theme/applyTheme'

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
    riskEnabled: true,
    riskThresholdMode: 'score',
    riskScoreThreshold: 70,
    riskGradeThresholdByScale: {
      bulgarian: 4.5,
      german: 3.5,
      percentage: 70,
    },
    riskLookback: 'currentTerm',
    riskMinDataPoints: 2,
    riskUseTermFinalIfAvailable: true,
    riskShowOnlyIfBelowThreshold: true,
    celebrationEnabled: true,
    celebrationScoreThreshold: 90,
    celebrationCooldownHours: 24,
    celebrationShowFor: 'all',
  },
  targets: weekdayOrder.map(({ weekday }) => ({ weekday, targetMinutes: 90 })),
  uiPreferences: {
    workspaceName: 'Study Hub',
    avatar: '✨',
    accentColor: '#e11d77',
    dashboardBackground:
      'radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)',
    themePreset: 'soft-rose',
    widgetStyle: 'soft',
    layoutDensity: 'comfortable',
  },
}

function createFormFromMe(meData: Awaited<ReturnType<typeof getMe>>): UpdatePreferencesDto {
  const settings = meData.settings
  const targetsByWeekday = new Map(meData.targets.map((target) => [target.weekday, target.targetMinutes]))
  const uiPreferences = meData.uiPreferences ?? defaultForm.uiPreferences

  return {
    settings: {
      cutoffTime: settings?.cutoffTime ?? '05:00',
      soundsEnabled: settings?.soundsEnabled ?? true,
      shortSessionMinutes: settings?.shortSessionMinutes ?? 10,
      breakSessionMinutes: settings?.breakSessionMinutes ?? 25,
      longSessionMinutes: settings?.longSessionMinutes ?? 50,
      adaptiveEnabled: settings?.adaptiveEnabled ?? true,
      riskEnabled: settings?.riskEnabled ?? true,
      riskThresholdMode: settings?.riskThresholdMode ?? 'score',
      riskScoreThreshold: settings?.riskScoreThreshold ?? 70,
      riskGradeThresholdByScale: {
        bulgarian: settings?.riskGradeThresholdByScale?.bulgarian ?? 4.5,
        german: settings?.riskGradeThresholdByScale?.german ?? 3.5,
        percentage: settings?.riskGradeThresholdByScale?.percentage ?? 70,
      },
      riskLookback: settings?.riskLookback ?? 'currentTerm',
      riskMinDataPoints: settings?.riskMinDataPoints ?? 2,
      riskUseTermFinalIfAvailable: settings?.riskUseTermFinalIfAvailable ?? true,
      riskShowOnlyIfBelowThreshold: settings?.riskShowOnlyIfBelowThreshold ?? true,
      celebrationEnabled: settings?.celebrationEnabled ?? true,
      celebrationScoreThreshold: settings?.celebrationScoreThreshold ?? 90,
      celebrationCooldownHours: settings?.celebrationCooldownHours ?? 24,
      celebrationShowFor: settings?.celebrationShowFor ?? 'all',
    },
    targets: weekdayOrder.map(({ weekday }) => ({
      weekday,
      targetMinutes: targetsByWeekday.get(weekday) ?? 90,
    })),
    uiPreferences: {
      ...uiPreferences,
      themePreset: normalizeTheme(uiPreferences.themePreset),
    },
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
  const [syncActionPending, setSyncActionPending] = useState(false)
  const [refreshStatusPending, setRefreshStatusPending] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  useUiPersonalization({
    workspaceName: form.uiPreferences?.workspaceName ?? 'Swot',
    avatar: form.uiPreferences?.avatar ?? '✨',
    accentColor: form.uiPreferences?.accentColor ?? '#1f1b1d',
    dashboardBackground:
      form.uiPreferences?.dashboardBackground ??
      'radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)',
    themePreset: form.uiPreferences?.themePreset ?? 'soft-rose',
    widgetStyle: form.uiPreferences?.widgetStyle ?? 'soft',
    layoutDensity: form.uiPreferences?.layoutDensity ?? 'comfortable',
  })

  const calendarFeedUrl = useMemo(() => {
    const apiUrl = import.meta.env.VITE_API_URL as string | undefined
    if (apiUrl && apiUrl.length > 0) {
      const base = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
      return `${base}/calendar.ics`
    }
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/calendar.ics`
    }
    return ''
  }, [])

  useEffect(() => {
    if (!meQuery.data) return
    if (!isInitialized) {
      const nextForm = createFormFromMe(meQuery.data)
      setForm(nextForm)
      if (import.meta.env.DEV && showDebug) {
        console.debug('[settings] loaded settings object', {
          meSettings: meQuery.data.settings,
          targets: meQuery.data.targets,
          uiPreferences: meQuery.data.uiPreferences,
          mappedForm: nextForm,
        })
      }
      setIsInitialized(true)
    }
  }, [isInitialized, meQuery.data, showDebug])

  useEffect(() => {
    if (!import.meta.env.DEV || !showDebug) return
    if (!isInitialized || !meQuery.data) return
    console.debug('[settings] loaded settings object', {
      meSettings: meQuery.data.settings,
      targets: meQuery.data.targets,
      uiPreferences: meQuery.data.uiPreferences,
      mappedForm: form,
    })
  }, [isInitialized, meQuery.data, showDebug])

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
    onError: (error) => {
      const message =
        error instanceof ApiError &&
        typeof error.details === 'object' &&
        error.details !== null &&
        'error' in error.details &&
        typeof (error.details as { error?: unknown }).error === 'string'
          ? String((error.details as { error: string }).error)
          : error instanceof ApiError
            ? `Request failed (${error.status})`
            : 'Could not save preferences. Please try again.'
      toast({
        variant: 'error',
        title: 'Save failed',
        description: message,
      })
    },
  })

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<string, string>> = {}
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!timePattern.test(form.settings.cutoffTime)) {
      errors.cutoffTime = 'Use HH:MM format.'
    }

    if (!Number.isFinite(form.settings.shortSessionMinutes) || form.settings.shortSessionMinutes <= 0) {
      errors.shortSessionMinutes = 'Must be greater than 0.'
    }
    if (!Number.isFinite(form.settings.breakSessionMinutes) || form.settings.breakSessionMinutes <= 0) {
      errors.breakSessionMinutes = 'Must be greater than 0.'
    }
    if (!Number.isFinite(form.settings.longSessionMinutes) || form.settings.longSessionMinutes <= 0) {
      errors.longSessionMinutes = 'Must be greater than 0.'
    }

    const invalidTarget = form.targets.some((item) => !Number.isFinite(item.targetMinutes) || item.targetMinutes < 0)
    if (invalidTarget) {
      errors.targets = 'Daily targets must be 0 or greater.'
    }

    const riskScore = Number(form.settings.riskScoreThreshold ?? 0)
    if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) {
      errors.riskScoreThreshold = 'Must be between 0 and 100.'
    }
    const bulgarian = Number(form.settings.riskGradeThresholdByScale?.bulgarian ?? 0)
    if (!Number.isFinite(bulgarian) || bulgarian < 2 || bulgarian > 6) {
      errors.riskBulgarian = 'Range: 2 to 6.'
    }
    const german = Number(form.settings.riskGradeThresholdByScale?.german ?? 0)
    if (!Number.isFinite(german) || german < 1 || german > 6) {
      errors.riskGerman = 'Range: 1 to 6.'
    }
    const percentage = Number(form.settings.riskGradeThresholdByScale?.percentage ?? 0)
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      errors.riskPercentage = 'Range: 0 to 100.'
    }

    if (!Number.isFinite(form.settings.riskMinDataPoints ?? 0) || (form.settings.riskMinDataPoints ?? 0) < 1) {
      errors.riskMinDataPoints = 'Must be at least 1.'
    }

    if (!Number.isFinite(form.settings.celebrationScoreThreshold ?? 0) || (form.settings.celebrationScoreThreshold ?? 0) < 0 || (form.settings.celebrationScoreThreshold ?? 0) > 100) {
      errors.celebrationScoreThreshold = 'Must be between 0 and 100.'
    }
    if (!Number.isFinite(form.settings.celebrationCooldownHours ?? 0) || (form.settings.celebrationCooldownHours ?? 0) < 1) {
      errors.celebrationCooldownHours = 'Must be at least 1.'
    }

    return errors
  }, [form])

  const validationError = useMemo(() => {
    const firstError = Object.values(fieldErrors).find((value) => Boolean(value))
    return firstError ?? null
  }, [fieldErrors])

  const canSave = !validationError && !mutation.isPending

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

  const accentPreview = useMemo(() => {
    const normalized = normalizeHexColor(form.uiPreferences?.accentColor)
    if (!normalized) return null
    return generateAccentShades(normalized)
  }, [form.uiPreferences?.accentColor])

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
    if (import.meta.env.DEV && showDebug) {
      console.debug('[settings] outgoing updatePreferences payload', form)
    }
    if (form.uiPreferences?.themePreset) {
      setTheme(form.uiPreferences.themePreset as ThemeName)
    }
    mutation.mutate(form)
  }

  const handleCopy = async () => {
    if (!calendarFeedUrl) {
      toast({
        variant: 'error',
        title: 'Link unavailable',
        description: 'Calendar feed URL could not be generated in this environment.',
      })
      return
    }
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
    const apiUrl = import.meta.env.VITE_API_URL as string | undefined
    const base = apiUrl && apiUrl.length > 0
      ? (apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl)
      : (typeof window !== 'undefined' ? window.location.origin : '')
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not generate study report right now.'
      toast({
        variant: 'error',
        title: 'Download failed',
        description: message,
      })
    } finally {
      setDownloadingReport(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncActionPending(true)
    try {
      await sync.syncNow()
      const latestSyncState = getSessionSyncState()
      await queryClient.invalidateQueries({ queryKey: ['health'] })
      toast({
        variant: 'success',
        title: 'Sync complete',
        description: latestSyncState.pendingCount > 0 ? `${latestSyncState.pendingCount} session(s) still queued.` : 'Session queue is up to date.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sync queued sessions.'
      toast({
        variant: 'error',
        title: 'Sync failed',
        description: message,
      })
    } finally {
      setSyncActionPending(false)
    }
  }

  const handleRefreshStatus = async () => {
    setRefreshStatusPending(true)
    try {
      await health.refetch()
      toast({
        variant: 'success',
        title: 'Status refreshed',
        description: 'API health status updated.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not refresh API status.'
      toast({
        variant: 'error',
        title: 'Refresh failed',
        description: message,
      })
    } finally {
      setRefreshStatusPending(false)
    }
  }

  if (meQuery.isPending) {
    return (
      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-soft">
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
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <SettingsCard
          title={
            <span className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Study Preferences
            </span>
          }
          description="Daily targets, cutoff, sounds, and adaptive pomodoro behavior."
          footer={
            <div className="ml-auto flex items-center gap-2">
              {import.meta.env.DEV ? (
                <Button variant="outline" onClick={() => setShowDebug((value) => !value)}>
                  {showDebug ? 'Hide debug' : 'Show debug'}
                </Button>
              ) : null}
              <Button onClick={handleSave} disabled={!canSave}>
                <Save className="h-4 w-4" />
                {mutation.isPending ? 'Saving...' : 'Save settings'}
              </Button>
            </div>
          }
        >
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
          {fieldErrors.targets ? <p className="text-xs text-destructive">{fieldErrors.targets}</p> : null}

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
              {fieldErrors.cutoffTime ? <p className="text-xs text-destructive">{fieldErrors.cutoffTime}</p> : null}
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

            <div className="rounded-lg border border-border/70 bg-background/70 p-3 sm:col-span-2">
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
        </SettingsCard>

        <SettingsCard
          title="Grades Risk / Needs Attention"
          description="Configure thresholding and academic risk signal behavior."
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Needs attention tracking</p>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    settings: { ...current.settings, riskEnabled: !(current.settings.riskEnabled ?? true) },
                  }))
                }
              >
                {(form.settings.riskEnabled ?? true) ? (
                  <>
                    <Check className="h-4 w-4 text-primary" /> Enabled
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" /> Disabled
                  </>
                )}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Threshold mode</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.settings.riskThresholdMode ?? 'score'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      settings: { ...current.settings, riskThresholdMode: event.target.value as 'score' | 'grade' },
                    }))
                  }
                >
                  <option value="score">Score (0-100)</option>
                  <option value="grade">Grade scale value</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Lookback</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.settings.riskLookback ?? 'currentTerm'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        riskLookback: event.target.value as 'currentTerm' | 'previousTerm' | 'academicYear',
                      },
                    }))
                  }
                >
                  <option value="currentTerm">Current term</option>
                  <option value="previousTerm">Previous term</option>
                  <option value="academicYear">Academic year</option>
                </select>
              </label>
            </div>

            {(form.settings.riskThresholdMode ?? 'score') === 'score' ? (
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Risk score threshold</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.settings.riskScoreThreshold ?? 70}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        riskScoreThreshold: Number(event.target.value || 0),
                      },
                    }))
                  }
                />
                {fieldErrors.riskScoreThreshold ? <p className="text-xs text-destructive">{fieldErrors.riskScoreThreshold}</p> : null}
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Bulgarian</span>
                  <Input
                    type="number"
                    step="0.1"
                    min={2}
                    max={6}
                    value={form.settings.riskGradeThresholdByScale?.bulgarian ?? 4.5}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          riskGradeThresholdByScale: {
                            ...(current.settings.riskGradeThresholdByScale ?? { bulgarian: 4.5, german: 3.5, percentage: 70 }),
                            bulgarian: Number(event.target.value || 0),
                          },
                        },
                      }))
                    }
                  />
                  {fieldErrors.riskBulgarian ? <p className="text-xs text-destructive">{fieldErrors.riskBulgarian}</p> : null}
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">German</span>
                  <Input
                    type="number"
                    step="0.1"
                    min={1}
                    max={6}
                    value={form.settings.riskGradeThresholdByScale?.german ?? 3.5}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          riskGradeThresholdByScale: {
                            ...(current.settings.riskGradeThresholdByScale ?? { bulgarian: 4.5, german: 3.5, percentage: 70 }),
                            german: Number(event.target.value || 0),
                          },
                        },
                      }))
                    }
                  />
                  {fieldErrors.riskGerman ? <p className="text-xs text-destructive">{fieldErrors.riskGerman}</p> : null}
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Percentage</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.settings.riskGradeThresholdByScale?.percentage ?? 70}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          riskGradeThresholdByScale: {
                            ...(current.settings.riskGradeThresholdByScale ?? { bulgarian: 4.5, german: 3.5, percentage: 70 }),
                            percentage: Number(event.target.value || 0),
                          },
                        },
                      }))
                    }
                  />
                  {fieldErrors.riskPercentage ? <p className="text-xs text-destructive">{fieldErrors.riskPercentage}</p> : null}
                </label>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Min data points</span>
                <Input
                  type="number"
                  min={1}
                  value={form.settings.riskMinDataPoints ?? 2}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        riskMinDataPoints: Number(event.target.value || 1),
                      },
                    }))
                  }
                />
                {fieldErrors.riskMinDataPoints ? <p className="text-xs text-destructive">{fieldErrors.riskMinDataPoints}</p> : null}
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Prefer term final</span>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        riskUseTermFinalIfAvailable: !(current.settings.riskUseTermFinalIfAvailable ?? true),
                      },
                    }))
                  }
                >
                  {(form.settings.riskUseTermFinalIfAvailable ?? true) ? 'Yes' : 'No'}
                </button>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Show only below threshold</span>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        riskShowOnlyIfBelowThreshold: !(current.settings.riskShowOnlyIfBelowThreshold ?? true),
                      },
                    }))
                  }
                >
                  {(form.settings.riskShowOnlyIfBelowThreshold ?? true) ? 'Yes' : 'No'}
                </button>
              </label>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Celebrations"
          description="Configure when celebration prompts appear and their cooldown behavior."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Celebrations enabled</span>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-md border border-input px-3 text-sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      celebrationEnabled: !(current.settings.celebrationEnabled ?? true),
                    },
                  }))
                }
              >
                {(form.settings.celebrationEnabled ?? true) ? 'Yes' : 'No'}
              </button>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Celebrate for</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.settings.celebrationShowFor ?? 'all'}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      celebrationShowFor: event.target.value as 'gradeItem' | 'termFinal' | 'courseAverage' | 'all',
                    },
                  }))
                }
              >
                <option value="all">All triggers</option>
                <option value="gradeItem">Grade items</option>
                <option value="termFinal">Term finals</option>
                <option value="courseAverage">Course average crossing</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Celebration score threshold</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.settings.celebrationScoreThreshold ?? 90}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      celebrationScoreThreshold: Number(event.target.value || 0),
                    },
                  }))
                }
              />
              {fieldErrors.celebrationScoreThreshold ? <p className="text-xs text-destructive">{fieldErrors.celebrationScoreThreshold}</p> : null}
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Cooldown (hours)</span>
              <Input
                type="number"
                min={1}
                value={form.settings.celebrationCooldownHours ?? 24}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      celebrationCooldownHours: Number(event.target.value || 1),
                    },
                  }))
                }
              />
              {fieldErrors.celebrationCooldownHours ? <p className="text-xs text-destructive">{fieldErrors.celebrationCooldownHours}</p> : null}
            </label>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Default Session Duration Buttons"
          description="Configure the three default quick-focus duration buttons."
          footer={
            <Button variant="outline" onClick={applyPreset}>Use 10 / 25 / 50</Button>
          }
        >
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
              {fieldErrors.shortSessionMinutes ? <p className="text-xs text-destructive">{fieldErrors.shortSessionMinutes}</p> : null}
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
              {fieldErrors.breakSessionMinutes ? <p className="text-xs text-destructive">{fieldErrors.breakSessionMinutes}</p> : null}
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
              {fieldErrors.longSessionMinutes ? <p className="text-xs text-destructive">{fieldErrors.longSessionMinutes}</p> : null}
            </label>
          </div>
        </SettingsCard>
      </div>

      <div className="space-y-4">
        <SettingsCard
          title={
            <span className="inline-flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              Theme Engine
            </span>
          }
          description="Choose and preview themes. Selection is saved locally."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded-lg border p-3 text-left transition ${
                  theme === option.value
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/70 bg-background hover:border-primary/30'
                }`}
                onClick={() => {
                  setTheme(option.value as ThemeName)
                  setForm((current) => ({
                    ...current,
                    uiPreferences: {
                      ...current.uiPreferences,
                      themePreset: option.value as ThemeName,
                    },
                  }))
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold">
                    <span className="flex items-center gap-1">
                      {option.preview.map((color) => (
                        <span key={color} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    {option.label}
                  </p>
                  {theme === option.value ? <Check className="h-4 w-4 text-primary" /> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard
          title="Personalization Studio"
          description="Live preview with accent, avatar, workspace, widget style, and density."
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
              {accentPreview ? (
                <div className="mt-2 space-y-1.5 rounded-md border border-border/70 bg-background/70 p-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Generated shades preview</p>
                  <div className="flex items-center gap-1.5">
                    {Object.entries(accentPreview.preview).map(([key, color]) => (
                      <span
                        key={key}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/70"
                        style={{ backgroundColor: color }}
                        title={`${key}: ${color}`}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Theme preset</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.uiPreferences?.themePreset ?? 'soft-rose'}
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
          <label className="block space-y-1.5">
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
          <div className="rounded-lg border border-border/70 p-3" style={{ backgroundImage: form.uiPreferences?.dashboardBackground }}>
            <p className="text-sm font-semibold">
              {form.uiPreferences?.avatar} {form.uiPreferences?.workspaceName}
            </p>
            <p className="text-xs text-muted-foreground">Live preview of your personal workspace identity.</p>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Focus Sounds Defaults"
          description="Saves your default sound setup for the Timer page."
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">YouTube embed URL (optional)</span>
            <Input
              value={soundPrefs.youtubeUrl}
              onChange={(event) => updateSoundPrefs({ youtubeUrl: event.target.value })}
              placeholder="https://www.youtube.com/embed/jfKfPfyJRdk"
            />
          </label>
        </SettingsCard>

        <SettingsCard
          title="Calendar Feed Export (.ics)"
          description="Subscribe in Google Calendar, Apple Calendar, or Outlook."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCalendarLink(true)}
              disabled={!calendarFeedUrl}
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
        </SettingsCard>

        <SettingsCard
          title="Study Report"
          description="Download a full PDF report with totals, streak stats, course breakdown, charts, and recent sessions."
        >
          <Button onClick={handleDownloadReport} disabled={downloadingReport}>
            <FileDown className="h-4 w-4" />
            {downloadingReport ? 'Generating report...' : 'Download Study Report'}
          </Button>
        </SettingsCard>

        <SettingsCard
          title="API Status"
          description="Connection and sync health for settings persistence."
          className="xl:sticky xl:top-20"
        >
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleSyncNow} disabled={sync.isSyncing || syncActionPending}>
              {sync.isSyncing || syncActionPending ? 'Syncing...' : 'Sync now'}
            </Button>
            <Button variant="outline" onClick={handleRefreshStatus} disabled={health.isFetching || refreshStatusPending}>
              {health.isFetching || refreshStatusPending ? 'Refreshing...' : 'Refresh status'}
            </Button>
          </div>
        </SettingsCard>
      </div>
    </section>
  )
}
