import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Clock3,
  Gauge,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Settings,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GlobalSearch } from '@/components/global-search'
import { getMe } from '@/api/me'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AchievementsPage } from '@/features/achievements/achievements-page'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { CoursesPage } from '@/features/courses/courses-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { InsightsPage } from '@/features/insights/insights-page'
import { PlannerPage } from '@/features/planner/planner-page'
import { SessionsPage } from '@/features/sessions/sessions-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { TimerPage } from '@/features/timer/timer-page'
import { useSessionSync } from '@/hooks/use-session-sync'
import { useUiPersonalization } from '@/hooks/use-ui-personalization'
import { useTheme, type ThemeName } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'Timer', label: 'Timer', icon: Clock3 },
  { name: 'Sessions', label: 'Sessions', icon: Gauge },
  { name: 'Courses', label: 'Courses', icon: BookOpen },
  { name: 'Planner', label: 'Planner', icon: CalendarClock },
  { name: 'Calendar', label: 'Calendar', icon: CalendarDays },
  { name: 'Insights', label: 'Insights', icon: BarChart3 },
  { name: 'Achievements', label: 'Achievements', icon: Award },
  { name: 'Settings', label: 'Settings', icon: Settings },
] as const

type NavName = (typeof navigation)[number]['name']

const navLabels: Record<NavName, string> = Object.fromEntries(navigation.map((item) => [item.name, item.label])) as Record<
  NavName,
  string
>
function App() {
  const [activeNav, setActiveNav] = useState<NavName>('Dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [createSessionSignal, setCreateSessionSignal] = useState(0)
  const [startTimerSignal, setStartTimerSignal] = useState(0)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const { theme, setTheme, options: themeOptions } = useTheme()
  const sync = useSessionSync()
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
  })
  useUiPersonalization(meQuery.data?.uiPreferences)

  useEffect(() => {
    const preferredTheme = meQuery.data?.uiPreferences?.themePreset
    if (!preferredTheme || preferredTheme === theme) return
    setTheme(preferredTheme)
  }, [meQuery.data?.uiPreferences?.themePreset, setTheme, theme])

  useEffect(() => {
    if (!mobileSidebarOpen) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileSidebarOpen(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [mobileSidebarOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable

      if (isTypingTarget && !event.metaKey && !event.ctrlKey && !event.altKey) return

      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        setActiveNav('Timer')
        setStartTimerSignal((current) => current + 1)
        return
      }

      if (event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        setActiveNav('Sessions')
        setCreateSessionSignal((current) => current + 1)
        return
      }

      if (event.altKey) {
        const pageByIndex: Record<string, NavName> = {
          '1': 'Dashboard',
          '2': 'Timer',
          '3': 'Sessions',
          '4': 'Courses',
          '5': 'Planner',
          '6': 'Calendar',
          '7': 'Insights',
          '8': 'Achievements',
          '9': 'Settings',
        }
        const targetPage = pageByIndex[event.key]
        if (targetPage) {
          event.preventDefault()
          setActiveNav(targetPage)
          setMobileSidebarOpen(false)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const syncBadgeLabel = sync.isSyncing
    ? `Syncing ${sync.pendingCount}`
    : sync.pendingCount > 0
      ? `Queued ${sync.pendingCount}`
      : 'Synced'

  const syncBadgeVariant = sync.pendingCount > 0 ? 'secondary' : 'outline'
  const workspaceName = meQuery.data?.uiPreferences?.workspaceName || 'Study Hub'
  const avatar = meQuery.data?.uiPreferences?.avatar || '✨'

  const renderActivePage = () => {
    if (activeNav === 'Settings') return <SettingsPage />
    if (activeNav === 'Sessions') return <SessionsPage openCreateSignal={createSessionSignal} />
    if (activeNav === 'Timer') return <TimerPage startFocusSignal={startTimerSignal} />
    if (activeNav === 'Courses') return <CoursesPage />
    if (activeNav === 'Planner') return <PlannerPage />
    if (activeNav === 'Calendar') return <CalendarPage />
    if (activeNav === 'Achievements') return <AchievementsPage />
    if (activeNav === 'Insights') return <InsightsPage />
    return <DashboardPage />
  }

  return (
    <div className="app-surface min-h-screen bg-background font-sans text-foreground">
      {mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      ) : null}

      <div className="flex min-h-screen">
        <motion.aside
          layout
          className={cn(
            'fixed inset-y-0 left-0 z-40 border-r border-border/70 bg-card/90 p-4 backdrop-blur-sm transition-all duration-200 md:static md:translate-x-0',
            sidebarCollapsed ? 'md:w-20' : 'md:w-64',
            mobileSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
          )}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex h-14 items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/20 text-primary">
                <span className="text-base leading-none">{avatar}</span>
              </div>
              <div className={cn('transition-opacity', sidebarCollapsed && 'md:hidden')}>
                <p className="text-sm font-semibold">{workspaceName}</p>
                <p className="text-xs text-muted-foreground">Focus Workspace</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <nav className="mt-4 space-y-1">
            {navigation.map((item) => (
              <motion.div key={item.name} whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }}>
                <Button
                  variant={activeNav === item.name ? 'secondary' : 'ghost'}
                  className={cn(
                    'h-10 w-full justify-start gap-3 rounded-lg px-3',
                    sidebarCollapsed && 'md:justify-center md:px-0',
                    activeNav === item.name && 'border border-border/50',
                  )}
                  onClick={() => {
                    setActiveNav(item.name)
                    setMobileSidebarOpen(false)
                  }}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className={cn(sidebarCollapsed && 'md:hidden')}>{item.label}</span>
                </Button>
              </motion.div>
            ))}
          </nav>
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-sm md:px-8">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="md:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hidden md:inline-flex"
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
              <p className="text-sm font-medium text-muted-foreground">{navLabels[activeNav]}</p>
              <Badge variant="outline" className="hidden md:inline-flex">{avatar} {workspaceName}</Badge>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              <GlobalSearch
                onNavigate={(target) => {
                  setActiveNav(target)
                  setMobileSidebarOpen(false)
                }}
                onCreateSession={() => {
                  setActiveNav('Sessions')
                  setCreateSessionSignal((current) => current + 1)
                }}
                onStartTimer={() => {
                  setActiveNav('Timer')
                  setStartTimerSignal((current) => current + 1)
                }}
              />

              <select
                className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                value={theme}
                onChange={(event) => setTheme(event.target.value as ThemeName)}
              >
                {themeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <Badge variant={syncBadgeVariant} className="hidden sm:inline-flex">
                {sync.isSyncing ? <RefreshCcw className="mr-1 h-3 w-3 animate-spin" /> : null}
                {syncBadgeLabel}
              </Badge>
              <Button
                onClick={() => {
                  setActiveNav('Timer')
                  setStartTimerSignal((current) => current + 1)
                }}
              >
                ▶️ Start Timer
              </Button>
              <Button variant="outline" size="icon" onClick={() => setShortcutsOpen(true)} aria-label="Show shortcuts">
                ?
              </Button>
            </div>
          </header>

          <main className="space-y-7 p-4 md:p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {renderActivePage()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⌨️ Keyboard Shortcuts</DialogTitle>
            <DialogDescription>Use shortcuts to move faster across the app.</DialogDescription>
          </DialogHeader>
          <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background/70 p-3 text-sm">
            <p className="flex items-center justify-between"><span>Command palette</span> <kbd className="rounded border px-1.5 py-0.5 text-xs">Cmd/Ctrl + K</kbd></p>
            <p className="flex items-center justify-between"><span>Start timer</span> <kbd className="rounded border px-1.5 py-0.5 text-xs">Shift + T</kbd></p>
            <p className="flex items-center justify-between"><span>Log session</span> <kbd className="rounded border px-1.5 py-0.5 text-xs">Shift + L</kbd></p>
            <p className="flex items-center justify-between"><span>Navigate pages</span> <kbd className="rounded border px-1.5 py-0.5 text-xs">Alt + 1..9</kbd></p>
            <p className="flex items-center justify-between"><span>Show this guide</span> <kbd className="rounded border px-1.5 py-0.5 text-xs">?</kbd></p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default App
