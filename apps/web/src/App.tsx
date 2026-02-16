import { useEffect, useState } from 'react'
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  Clock3,
  Gauge,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AchievementsPage } from '@/features/achievements/achievements-page'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { CoursesPage } from '@/features/courses/courses-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { InsightsPage } from '@/features/insights/insights-page'
import { SessionsPage } from '@/features/sessions/sessions-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { TimerPage } from '@/features/timer/timer-page'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Timer', icon: Clock3 },
  { name: 'Sessions', icon: Gauge },
  { name: 'Courses', icon: BookOpen },
  { name: 'Calendar', icon: CalendarDays },
  { name: 'Insights', icon: BarChart3 },
  { name: 'Achievements', icon: Award },
  { name: 'Settings', icon: Settings },
] as const

type NavName = (typeof navigation)[number]['name']
type ThemeName = 'pink' | 'neutral' | 'dark'

function App() {
  const [activeNav, setActiveNav] = useState<NavName>('Dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = window.localStorage.getItem('swot-theme')
    if (stored === 'pink' || stored === 'neutral' || stored === 'dark') return stored
    return 'pink'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('swot-theme', theme)
  }, [theme])

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
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 border-r border-border/70 bg-card/90 p-4 backdrop-blur-sm transition-all duration-200 md:static md:translate-x-0',
            sidebarCollapsed ? 'md:w-20' : 'md:w-64',
            mobileSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64',
          )}
        >
          <div className="flex h-14 items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/20 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className={cn('transition-opacity', sidebarCollapsed && 'md:hidden')}>
                <p className="text-sm font-semibold">Study Hub</p>
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
              <Button
                key={item.name}
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
                <span className={cn(sidebarCollapsed && 'md:hidden')}>{item.name}</span>
              </Button>
            ))}
          </nav>
        </aside>

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
              <p className="text-sm font-medium text-muted-foreground">{activeNav}</p>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
                <Input className="w-64 pl-9" placeholder="Search sessions..." />
              </div>

              <select
                className="h-9 rounded-md border border-input bg-background px-2.5 text-xs font-medium"
                value={theme}
                onChange={(event) => setTheme(event.target.value as ThemeName)}
              >
                <option value="pink">Pink</option>
                <option value="neutral">Neutral</option>
                <option value="dark">Dark</option>
              </select>

              <Badge className="hidden sm:inline-flex">Streak: 12 days</Badge>
              <Button onClick={() => setActiveNav('Timer')}>Start Timer</Button>
            </div>
          </header>

          <main className="space-y-7 p-4 md:p-8">
            {activeNav === 'Settings' ? <SettingsPage /> : null}
            {activeNav === 'Sessions' ? <SessionsPage /> : null}
            {activeNav === 'Timer' ? <TimerPage /> : null}
            {activeNav === 'Courses' ? <CoursesPage /> : null}
            {activeNav === 'Calendar' ? <CalendarPage /> : null}
            {activeNav === 'Achievements' ? <AchievementsPage /> : null}
            {activeNav === 'Insights' ? <InsightsPage /> : null}
            {activeNav !== 'Settings' &&
            activeNav !== 'Sessions' &&
            activeNav !== 'Timer' &&
            activeNav !== 'Courses' &&
            activeNav !== 'Calendar' &&
            activeNav !== 'Achievements' &&
            activeNav !== 'Insights' ? (
              <DashboardPage />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
