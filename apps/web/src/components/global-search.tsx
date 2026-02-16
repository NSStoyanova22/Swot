import { Fragment, type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Play,
  Search,
  Timer,
} from 'lucide-react'

import { getCourses } from '@/api/courses'
import type { SessionDto } from '@/api/dtos'
import { getSessions } from '@/api/sessions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SearchTarget =
  | 'Dashboard'
  | 'Timer'
  | 'Sessions'
  | 'Courses'
  | 'Planner'
  | 'Calendar'
  | 'Insights'
  | 'Achievements'
  | 'Settings'

type SearchResult = {
  id: string
  section: 'actions' | 'navigation' | 'sessions' | 'courses' | 'notes'
  title: string
  subtitle: string
  noteText?: string
  onSelect: () => void
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return [text]
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedQuery})`, 'ig')
  const parts = text.split(regex)

  return parts.map((part, index) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return (
        <mark key={`${part}-${index}`} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
          {part}
        </mark>
      )
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>
  })
}

function formatSessionSubtitle(session: SessionDto) {
  const date = new Date(session.startTime).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const duration = `${session.durationMinutes}m`
  const activity = session.activity?.name ? ` · ${session.activity.name}` : ''
  return `${date} · ${duration}${activity}`
}

function buildNoteSnippet(note: string, query: string) {
  const clean = note.replace(/\s+/g, ' ').trim()
  if (!query.trim()) return clean.slice(0, 140)
  const index = clean.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return clean.slice(0, 140)

  const start = Math.max(0, index - 45)
  const end = Math.min(clean.length, index + query.length + 75)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < clean.length ? '...' : ''
  return `${prefix}${clean.slice(start, end)}${suffix}`
}

export function GlobalSearch({
  onNavigate,
  onCreateSession,
  onStartTimer,
}: {
  onNavigate: (target: SearchTarget) => void
  onCreateSession: () => void
  onStartTimer: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'global-search'],
    queryFn: ({ signal }) => getSessions({}, signal),
    enabled: open,
    staleTime: 60_000,
  })
  const coursesQuery = useQuery({
    queryKey: ['courses', 'global-search'],
    queryFn: ({ signal }) => getCourses(signal),
    enabled: open,
    staleTime: 60_000,
  })

  const queryLower = query.trim().toLowerCase()

  const quickActionResults = useMemo<SearchResult[]>(() => {
    const actions: SearchResult[] = [
      {
        id: 'action-create-session',
        section: 'actions',
        title: 'Create session',
        subtitle: 'Open session logger',
        onSelect: () => {
          onNavigate('Sessions')
          onCreateSession()
        },
      },
      {
        id: 'action-start-timer',
        section: 'actions',
        title: 'Start timer',
        subtitle: 'Start focus mode immediately',
        onSelect: () => {
          onNavigate('Timer')
          onStartTimer()
        },
      },
    ]

    if (!queryLower) return actions
    return actions.filter(
      (item) =>
        item.title.toLowerCase().includes(queryLower) || item.subtitle.toLowerCase().includes(queryLower),
    )
  }, [onCreateSession, onNavigate, onStartTimer, queryLower])

  const navigationResults = useMemo<SearchResult[]>(() => {
    const pages: Array<{ title: SearchTarget; subtitle: string }> = [
      { title: 'Dashboard', subtitle: 'Overview and metrics' },
      { title: 'Sessions', subtitle: 'Study logs' },
      { title: 'Timer', subtitle: 'Pomodoro and manual timer' },
      { title: 'Courses', subtitle: 'Course and activity management' },
      { title: 'Planner', subtitle: 'Weekly study planning' },
      { title: 'Calendar', subtitle: 'Monthly schedule' },
      { title: 'Insights', subtitle: 'Learning analytics' },
      { title: 'Achievements', subtitle: 'Badges and medals' },
      { title: 'Settings', subtitle: 'Preferences and API status' },
    ]

    return pages
      .filter((page) => {
        if (!queryLower) return true
        return (
          page.title.toLowerCase().includes(queryLower) || page.subtitle.toLowerCase().includes(queryLower)
        )
      })
      .slice(0, 8)
      .map((page) => ({
        id: `nav-${page.title}`,
        section: 'navigation',
        title: page.title,
        subtitle: page.subtitle,
        onSelect: () => onNavigate(page.title),
      }))
  }, [onNavigate, queryLower])

  const sessionResults = useMemo<SearchResult[]>(() => {
    const sessions = sessionsQuery.data ?? []
    return sessions
      .filter((session) => {
        if (!queryLower) return false
        const values = [
          session.course?.name ?? '',
          session.activity?.name ?? '',
          session.note ?? '',
          new Date(session.startTime).toLocaleDateString(),
        ]
        return values.some((value) => value.toLowerCase().includes(queryLower))
      })
      .slice(0, 7)
      .map((session) => ({
        id: `session-${session.id}`,
        section: 'sessions',
        title: session.course?.name ?? 'Session',
        subtitle: formatSessionSubtitle(session),
        onSelect: () => onNavigate('Sessions'),
      }))
  }, [onNavigate, queryLower, sessionsQuery.data])

  const courseResults = useMemo<SearchResult[]>(() => {
    const courses = coursesQuery.data ?? []
    return courses
      .filter((course) => (!queryLower ? false : course.name.toLowerCase().includes(queryLower)))
      .slice(0, 7)
      .map((course) => ({
        id: `course-${course.id}`,
        section: 'courses',
        title: course.name,
        subtitle: 'Course',
        onSelect: () => onNavigate('Courses'),
      }))
  }, [coursesQuery.data, onNavigate, queryLower])

  const noteResults = useMemo<SearchResult[]>(() => {
    const sessions = sessionsQuery.data ?? []
    return sessions
      .filter((session) => (!queryLower ? false : (session.note ?? '').toLowerCase().includes(queryLower)))
      .slice(0, 7)
      .map((session) => ({
        id: `note-${session.id}`,
        section: 'notes',
        title: session.course?.name ?? 'Session note',
        subtitle: formatSessionSubtitle(session),
        noteText: buildNoteSnippet(session.note ?? '', query),
        onSelect: () => onNavigate('Sessions'),
      }))
  }, [onNavigate, query, queryLower, sessionsQuery.data])

  const allResults = useMemo(
    () => [...quickActionResults, ...navigationResults, ...sessionResults, ...courseResults, ...noteResults],
    [courseResults, navigationResults, noteResults, quickActionResults, sessionResults],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
        return
      }

      if (!open) return

      if (event.key === 'Escape') {
        setOpen(false)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => Math.min(current + 1, Math.max(0, allResults.length - 1)))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => Math.max(0, current - 1))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = allResults[selectedIndex]
        if (selected) {
          selected.onSelect()
          setOpen(false)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [allResults, open, selectedIndex])

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 12)
      setSelectedIndex(0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const renderSection = (
    title: string,
    items: SearchResult[],
    icon: ComponentType<{ className?: string }>,
  ) => {
    if (items.length === 0) return null
    const Icon = icon
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </p>
        <div className="space-y-1">
          {items.map((item) => {
            const index = allResults.findIndex((result) => result.id === item.id)
            const active = index === selectedIndex
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'w-full rounded-md border border-transparent px-3 py-2 text-left transition',
                  active && 'border-primary/40 bg-primary/10',
                  !active && 'hover:border-border hover:bg-background/70',
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  item.onSelect()
                  setOpen(false)
                }}
              >
                <p className="text-sm font-medium">{highlightText(item.title, query)}</p>
                <p className="text-xs text-muted-foreground">{highlightText(item.subtitle, query)}</p>
                {item.noteText ? (
                  <p className="mt-1 text-xs text-muted-foreground">{highlightText(item.noteText, query)}</p>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const isLoading = sessionsQuery.isPending || coursesQuery.isPending

  return (
    <>
      <Button variant="outline" className="hidden w-[19rem] justify-between md:flex" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Search className="h-4 w-4" />
          Command palette...
        </span>
        <Badge variant="secondary" className="ml-2">
          Cmd+K
        </Badge>
      </Button>

      <Button variant="outline" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0">
          <div className="border-b border-border/70 p-3">
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type to navigate, run quick actions, or search..."
              className="h-11"
            />
          </div>

          <div className="max-h-[62vh] overflow-y-auto p-3">
            {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading search index...</p> : null}
            {!isLoading && allResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No matching results.</p>
            ) : null}

            {!isLoading && allResults.length > 0 ? (
              <div className="space-y-4">
                {renderSection('Quick Actions', quickActionResults, Play)}
                {renderSection('Navigation', navigationResults, LayoutDashboard)}
                {renderSection('Sessions', sessionResults, Timer)}
                {renderSection('Courses', courseResults, BookOpen)}
                {renderSection('Notes', noteResults, FileText)}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
