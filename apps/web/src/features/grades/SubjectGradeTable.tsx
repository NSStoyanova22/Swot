import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Search, Trash2 } from 'lucide-react'

import type { AcademicRiskDto, GradeItemDto, GradeScale } from '@/api/dtos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { GradeChip } from '@/features/grades/GradeChip'
import { cn } from '@/lib/utils'

type CourseRow = {
  courseId: string
  courseName: string
  currentGrades: GradeItemDto[]
  termGrade: GradeItemDto | null
  avgRaw: number | null
  avgScore: number | null
  lastDate: string | null
  allGrades: GradeItemDto[]
}

function fromPerformanceScore(scale: GradeScale, score: number) {
  if (scale === 'german') return 6 - (score / 100) * 5
  if (scale === 'bulgarian') return 2 + (score / 100) * 4
  return score
}

function toDisplayValue(item: GradeItemDto, displayScale: GradeScale) {
  if (item.scale === displayScale) return item.gradeValue
  return fromPerformanceScore(displayScale, item.performanceScore)
}

function isTermGrade(item: GradeItemDto) {
  return item.category?.name?.trim().toLowerCase() === 'term grade' || item.isFinal
}

export function groupGradeItemsByCourse(
  grades: GradeItemDto[],
  displayScale: GradeScale,
  includeTermGrade: boolean,
): CourseRow[] {
  const byCourse = new Map<string, GradeItemDto[]>()
  for (const item of grades) {
    const list = byCourse.get(item.courseId) ?? []
    list.push(item)
    byCourse.set(item.courseId, list)
  }

  return Array.from(byCourse.entries())
    .map(([courseId, items]) => {
      const sorted = items
        .slice()
        .sort((a, b) => new Date(b.gradedOn).getTime() - new Date(a.gradedOn).getTime())
      const termGrade = sorted.find(isTermGrade) ?? null
      const currentGrades = sorted.filter((item) => !isTermGrade(item))
      const forAverage = includeTermGrade && termGrade ? [...currentGrades, termGrade] : currentGrades
      const avgRaw =
        forAverage.length > 0
          ? forAverage.reduce((sum, item) => sum + toDisplayValue(item, displayScale), 0) / forAverage.length
          : null
      const avgScore =
        forAverage.length > 0
          ? forAverage.reduce((sum, item) => sum + item.performanceScore, 0) / forAverage.length
          : null
      const courseName =
        sorted[0]?.course?.name ??
        sorted[0]?.importMetadata?.courseName?.toString() ??
        courseId
      return {
        courseId,
        courseName,
        currentGrades,
        termGrade,
        avgRaw,
        avgScore,
        lastDate: sorted[0]?.gradedOn ?? null,
        allGrades: sorted,
      }
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName))
}

export function SubjectGradeTable({
  grades,
  displayScale,
  includeTermGrade,
  riskByCourseId,
  onSelectCourse,
  onOpenAddGradeForCourse,
  onUpdateGrade,
  onDeleteGrade,
  onDeleteCourseGrades,
  pending,
  loading,
}: {
  grades: GradeItemDto[]
  displayScale: GradeScale
  includeTermGrade: boolean
  riskByCourseId: Map<string, AcademicRiskDto>
  onSelectCourse: (courseId: string) => void
  onOpenAddGradeForCourse: (courseId: string) => void
  onUpdateGrade: (gradeId: string, payload: { scale: GradeScale; gradeValue: number; weight: number; gradedOn: string; note?: string }) => void
  onDeleteGrade: (gradeId: string) => Promise<void>
  onDeleteCourseGrades: (gradeIds: string[]) => void
  pending?: boolean
  loading?: boolean
}) {
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'needs-attention' | 'has-term-grade'>('all')
  const [sortBy, setSortBy] = useState<'attention' | 'name' | 'average' | 'last-grade'>('attention')
  const [editGrade, setEditGrade] = useState<GradeItemDto | null>(null)
  const [editForm, setEditForm] = useState({
    scale: 'bulgarian' as GradeScale,
    gradeValue: '',
    weight: '1',
    gradedOn: '',
    note: '',
  })
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null)

  const rows = useMemo(
    () => groupGradeItemsByCourse(grades, displayScale, includeTermGrade),
    [grades, displayScale, includeTermGrade],
  )

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (query && !row.courseName.toLowerCase().includes(query)) return false
      if (filter === 'needs-attention' && (riskByCourseId.get(row.courseId)?.riskLevel ?? 'low') === 'low') return false
      if (filter === 'has-term-grade' && !row.termGrade) return false
      return true
    })

    const byName = (a: CourseRow, b: CourseRow) => a.courseName.localeCompare(b.courseName)
    const byAverageAsc = (a: CourseRow, b: CourseRow) => {
      if (a.avgRaw == null && b.avgRaw == null) return 0
      if (a.avgRaw == null) return 1
      if (b.avgRaw == null) return -1
      return a.avgRaw - b.avgRaw
    }
    const byLastDateDesc = (a: CourseRow, b: CourseRow) => {
      const aTime = a.lastDate ? new Date(a.lastDate).getTime() : 0
      const bTime = b.lastDate ? new Date(b.lastDate).getTime() : 0
      return bTime - aTime
    }
    const byAttentionDesc = (a: CourseRow, b: CourseRow) =>
      (riskByCourseId.get(b.courseId)?.riskScore ?? 0) - (riskByCourseId.get(a.courseId)?.riskScore ?? 0)

    return filtered.slice().sort((a, b) => {
      if (sortBy === 'name') return byName(a, b)
      if (sortBy === 'average') {
        const avg = byAverageAsc(a, b)
        if (avg !== 0) return avg
        return byName(a, b)
      }
      if (sortBy === 'last-grade') {
        const last = byLastDateDesc(a, b)
        if (last !== 0) return last
        return byName(a, b)
      }

      const attention = byAttentionDesc(a, b)
      if (attention !== 0) return attention
      const avg = byAverageAsc(a, b)
      if (avg !== 0) return avg
      return byName(a, b)
    })
  }, [filter, riskByCourseId, rows, search, sortBy])

  const summary = useMemo(() => {
    const withAverage = rows.filter((row) => row.avgRaw != null && row.avgScore != null)
    const overallRaw = withAverage.length
      ? withAverage.reduce((sum, row) => sum + (row.avgRaw ?? 0), 0) / withAverage.length
      : null
    const overallScore = withAverage.length
      ? withAverage.reduce((sum, row) => sum + (row.avgScore ?? 0), 0) / withAverage.length
      : null
    const byAverageAsc = withAverage.slice().sort((a, b) => (a.avgRaw ?? 0) - (b.avgRaw ?? 0))
    return {
      overallRaw,
      overallScore,
      worst3: byAverageAsc.slice(0, 3),
      best3: byAverageAsc.slice(-3).reverse(),
    }
  }, [rows])

  const openEdit = (grade: GradeItemDto) => {
    setEditGrade(grade)
    setEditForm({
      scale: grade.scale,
      gradeValue: String(grade.gradeValue),
      weight: String(grade.weight),
      gradedOn: grade.gradedOn,
      note: grade.note ?? '',
    })
  }

  const renderCurrentChips = (row: CourseRow) => {
    const expanded = expandedIds.includes(row.courseId)
    const shouldOverflow = row.currentGrades.length > 12
    const visible = expanded || !shouldOverflow ? row.currentGrades : row.currentGrades.slice(0, 10)
    const hiddenCount = shouldOverflow ? Math.max(0, row.currentGrades.length - 10) : 0
    return (
      <div className="space-y-1">
        <div className="flex max-h-[4.4rem] min-h-[2rem] flex-wrap items-center gap-1.5 overflow-hidden">
          <Button
            size="icon"
            variant="outline"
            className="h-6 w-6 rounded-full"
            title="Add grade for this subject"
            onClick={() => onOpenAddGradeForCourse(row.courseId)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {visible.map((grade) => (
            <GradeChip
              key={grade.id}
              scale={grade.scale}
              value={grade.gradeValue}
              title={`${grade.category?.name ?? 'No category'} • ${new Date(grade.gradedOn).toLocaleDateString()} • weight ${grade.weight.toFixed(2)}${grade.note ? ` • ${grade.note}` : ''}`}
              onClick={() => openEdit(grade)}
            />
          ))}
          {visible.length === 0 ? <span className="text-xs text-muted-foreground">-</span> : null}
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="inline-flex items-center rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              onClick={() =>
                setExpandedIds((current) =>
                  current.includes(row.courseId)
                    ? current.filter((id) => id !== row.courseId)
                    : [...current, row.courseId],
                )
              }
            >
              +{hiddenCount} more
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const renderDesktop = () => (
    <div className="hidden max-h-[68vh] overflow-auto rounded-lg border border-border/70 lg:block">
      <Table>
        <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <TableRow className="border-b border-border/70">
            <TableHead>Subject</TableHead>
            <TableHead>Current grades</TableHead>
            <TableHead>Term grade</TableHead>
            <TableHead>Average</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((row, index) => {
            const expanded = expandedIds.includes(row.courseId)
            return (
              <Fragment key={row.courseId}>
                <TableRow
                  key={row.courseId}
                  className={cn(
                    'border-b border-border/50 hover:bg-primary/5',
                    index % 2 === 0 ? 'bg-background/50' : 'bg-muted/[0.12] dark:bg-white/[0.015]',
                  )}
                >
                  <TableCell className="min-w-[220px] align-top">
                    <button type="button" className="text-left" onClick={() => onSelectCourse(row.courseId)}>
                      <p className="font-medium">{row.courseName}</p>
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {row.allGrades.length} grades
                      {row.lastDate ? ` • last ${new Date(row.lastDate).toLocaleDateString()}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="align-top">{renderCurrentChips(row)}</TableCell>
                  <TableCell className="align-top">
                    {row.termGrade ? (
                      <GradeChip
                        scale={row.termGrade.scale}
                        value={row.termGrade.gradeValue}
                        title={`Term grade • ${new Date(row.termGrade.gradedOn).toLocaleDateString()}`}
                        onClick={() => openEdit(row.termGrade!)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <p className="text-base font-semibold">
                      {row.avgRaw == null ? '-' : row.avgRaw.toFixed(displayScale === 'percentage' ? 1 : 2)}
                    </p>
                    <p className="text-xs text-muted-foreground">({row.avgScore == null ? '-' : row.avgScore.toFixed(1)} score)</p>
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setExpandedIds((current) =>
                          expanded ? current.filter((id) => id !== row.courseId) : [...current, row.courseId],
                        )
                      }
                    >
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow key={`${row.courseId}-expanded`} className="border-b border-border/50 bg-background/70">
                    <TableCell colSpan={5}>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => onOpenAddGradeForCourse(row.courseId)}>
                            <Plus className="h-4 w-4" />
                            Add grade
                          </Button>
                          <Button
                            size="sm"
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => setConfirmDeleteIds(row.allGrades.map((grade) => grade.id))}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete course grades from this term
                          </Button>
                        </div>
                        <div className="max-h-40 overflow-y-auto rounded-md border border-border/70 bg-background/70 p-2">
                          {row.allGrades.map((grade) => (
                            <div key={grade.id} className="mb-1 flex items-center justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <span className="font-medium">{new Date(grade.gradedOn).toLocaleDateString()}</span>
                                <span className="ml-1 text-muted-foreground">{grade.category?.name ?? 'No category'}</span>
                                {grade.note ? <span className="ml-1 text-muted-foreground">• {grade.note}</span> : null}
                              </div>
                              <div className="flex items-center gap-1">
                                <GradeChip scale={grade.scale} value={grade.gradeValue} onClick={() => openEdit(grade)} />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={pending}
                                  onClick={async () => {
                                    await onDeleteGrade(grade.id)
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  const renderMobile = () => (
    <div className="space-y-3 lg:hidden">
      {filteredRows.map((row) => {
        const expanded = expandedIds.includes(row.courseId)
        return (
          <div key={row.courseId} className="rounded-lg border border-border/70 bg-background/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{row.courseName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.allGrades.length} grades
                  {row.lastDate ? ` • ${new Date(row.lastDate).toLocaleDateString()}` : ''}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setExpandedIds((current) =>
                    expanded ? current.filter((id) => id !== row.courseId) : [...current, row.courseId],
                  )
                }
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current grades</p>
                {renderCurrentChips(row)}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Term grade</p>
                {row.termGrade ? <GradeChip scale={row.termGrade.scale} value={row.termGrade.gradeValue} onClick={() => openEdit(row.termGrade!)} /> : <span className="text-xs text-muted-foreground">-</span>}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Average</p>
                <p className="text-sm font-semibold">
                  {row.avgRaw == null ? '-' : row.avgRaw.toFixed(displayScale === 'percentage' ? 1 : 2)}
                  <span className="ml-1 text-xs text-muted-foreground">({row.avgScore == null ? '-' : row.avgScore.toFixed(1)} score)</span>
                </p>
              </div>
              {expanded ? (
                <div className="space-y-2 rounded-md border border-border/70 bg-background/70 p-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onOpenAddGradeForCourse(row.courseId)}>
                      <Plus className="h-4 w-4" />
                      Add grade
                    </Button>
                    <Button
                      size="sm"
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => setConfirmDeleteIds(row.allGrades.map((grade) => grade.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete subject grades
                    </Button>
                  </div>
                  <div className="max-h-36 overflow-y-auto">
                    {row.allGrades.map((grade) => (
                      <div key={grade.id} className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <span className="font-medium">{new Date(grade.gradedOn).toLocaleDateString()}</span>
                          <span className="ml-1 text-muted-foreground">{grade.category?.name ?? 'No category'}</span>
                        </div>
                        <GradeChip scale={grade.scale} value={grade.gradeValue} onClick={() => openEdit(grade)} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )

  const renderSkeleton = () => (
    <div className="space-y-2 rounded-lg border border-border/70 p-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={`subject-skeleton-${index}`}
          className="grid animate-pulse grid-cols-[1.2fr_1.6fr_0.7fr_0.7fr_36px] items-center gap-2 rounded-md border border-border/40 p-2"
        >
          <div className="h-4 rounded bg-muted/70" />
          <div className="flex gap-1">
            <div className="h-5 w-10 rounded-full bg-muted/70" />
            <div className="h-5 w-10 rounded-full bg-muted/70" />
            <div className="h-5 w-10 rounded-full bg-muted/70" />
          </div>
          <div className="h-5 w-12 rounded-full bg-muted/70" />
          <div className="h-4 rounded bg-muted/70" />
          <div className="h-6 w-6 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg border border-border/70 bg-background/70 p-3 md:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overall average</p>
          <p className="mt-1 text-lg font-semibold">
            {summary.overallRaw == null ? '-' : summary.overallRaw.toFixed(displayScale === 'percentage' ? 1 : 2)}
            <span className="ml-1 text-xs text-muted-foreground">
              ({summary.overallScore == null ? '-' : summary.overallScore.toFixed(1)} score)
            </span>
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Worst 3 subjects</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {summary.worst3.length ? summary.worst3.map((row) => (
              <span key={`worst-${row.courseId}`} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs">
                <span className="max-w-[90px] truncate">{row.courseName}</span>
                {row.avgRaw != null ? <GradeChip scale={displayScale} value={row.avgRaw} className="px-1.5 py-0 text-[10px]" /> : null}
              </span>
            )) : <span className="text-xs text-muted-foreground">-</span>}
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Best 3 subjects</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {summary.best3.length ? summary.best3.map((row) => (
              <span key={`best-${row.courseId}`} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs">
                <span className="max-w-[90px] truncate">{row.courseName}</span>
                {row.avgRaw != null ? <GradeChip scale={displayScale} value={row.avgRaw} className="px-1.5 py-0 text-[10px]" /> : null}
              </span>
            )) : <span className="text-xs text-muted-foreground">-</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-7"
            placeholder="Search subject"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value as 'all' | 'needs-attention' | 'has-term-grade')}
        >
          <option value="all">All subjects</option>
          <option value="needs-attention">Needs attention</option>
          <option value="has-term-grade">Has term grade</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as 'attention' | 'name' | 'average' | 'last-grade')}
        >
          <option value="attention">Sort: Attention</option>
          <option value="name">Sort: Name</option>
          <option value="average">Sort: Average</option>
          <option value="last-grade">Sort: Last grade</option>
        </select>
      </div>

      {loading ? (
        renderSkeleton()
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
          No subjects found for this filter.
        </div>
      ) : (
        <>
          {renderDesktop()}
          {renderMobile()}
        </>
      )}

      <Dialog open={Boolean(confirmDeleteIds)} onOpenChange={(open) => !open && setConfirmDeleteIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete course grades?</DialogTitle>
            <DialogDescription>
              This will delete {confirmDeleteIds?.length ?? 0} grade item(s) from this term.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteIds(null)}>
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirmDeleteIds?.length) return
                onDeleteCourseGrades(confirmDeleteIds)
                setConfirmDeleteIds(null)
              }}
              disabled={pending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editGrade)} onOpenChange={(open) => !open && setEditGrade(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit grade</DialogTitle>
            <DialogDescription>Update value, scale, weight, date, and note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium">Scale</span>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={editForm.scale}
                  onChange={(event) => setEditForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                >
                  <option value="bulgarian">Bulgarian (2-6)</option>
                  <option value="percentage">Percentage (0-100)</option>
                  <option value="german">German (1-6)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">Grade</span>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.gradeValue}
                  onChange={(event) => setEditForm((current) => ({ ...current, gradeValue: event.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">Weight</span>
                <Input
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={editForm.weight}
                  onChange={(event) => setEditForm((current) => ({ ...current, weight: event.target.value }))}
                />
              </label>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-medium">Date</span>
              <Input
                type="date"
                value={editForm.gradedOn}
                onChange={(event) => setEditForm((current) => ({ ...current, gradedOn: event.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Note</span>
              <Textarea
                rows={3}
                value={editForm.note}
                onChange={(event) => setEditForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>
          </div>
          <DialogFooter>
            {editGrade ? (
              <Button
                variant="outline"
                onClick={async () => {
                  await onDeleteGrade(editGrade.id)
                  setEditGrade(null)
                }}
                disabled={pending}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setEditGrade(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editGrade) return
                const gradeValue = Number(editForm.gradeValue)
                const weight = Number(editForm.weight)
                if (!Number.isFinite(gradeValue) || !Number.isFinite(weight) || !editForm.gradedOn) return
                onUpdateGrade(editGrade.id, {
                  scale: editForm.scale,
                  gradeValue,
                  weight,
                  gradedOn: editForm.gradedOn,
                  note: editForm.note.trim() ? editForm.note.trim() : undefined,
                })
                setEditGrade(null)
              }}
              disabled={pending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
