import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Calculator, CalendarPlus2, GraduationCap, Plus, Trash2 } from 'lucide-react'

import { getCourses } from '@/api/courses'
import { autoAddPlannerBlocks, deletePlannerBlock } from '@/api/planner'
import { createOrganizationTask } from '@/api/organization'
import { bulkImportGrades, createGrade, createGradeCategory, createTerm, deleteGrade, deleteGradeCategory, deleteTerm, extractTextFromImage, getAcademicRisk, getGradeCategories, getGradeTargets, getGrades, getGradesSummary, getGradesWhatIf, getStudyRecommendations, getTerms, updateGradeCategory, upsertGradeTarget } from '@/api/grades'
import type { GradeCategoryDto, GradeItemDto, GradeScale } from '@/api/dtos'
import { PageContainer, PageHeader } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { matchExtractedCoursesToUserCourses } from '@/features/grades/course-matching'
import { parseGradeSheetLine } from '@/features/grades/parse-grade-sheet'
import { cn } from '@/lib/utils'

const termsKey = ['terms'] as const

function defaultSchoolYear() {
  const now = new Date()
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}/${String(year + 1).slice(2)}`
}

function formatScore(value: number | null | undefined) {
  if (value == null) return '-'
  return `${value.toFixed(1)}`
}

function formatGrade(scale: GradeScale, value: number) {
  if (scale === 'percentage') return `${value.toFixed(1)}%`
  return value.toFixed(2).replace(/\.00$/, '')
}

function getWeekStart(date = new Date()) {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  const offset = (value.getDay() + 6) % 7
  value.setDate(value.getDate() - offset)
  return value
}

function averageForCategory(items: GradeItemDto[], dropLowest: boolean) {
  if (!items.length) return null
  const effective = dropLowest && items.length > 1
    ? items.slice().sort((a, b) => a.performanceScore - b.performanceScore).slice(1)
    : items
  const totalWeight = effective.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return null
  return effective.reduce((sum, item) => sum + item.performanceScore * item.weight, 0) / totalWeight
}

export function GradesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedTermId, setSelectedTermId] = useState<string>('')
  const [selectedCourseId, setSelectedCourseId] = useState<string>('')
  const [addGradeOpen, setAddGradeOpen] = useState(false)
  const [addTermOpen, setAddTermOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importPhotoOpen, setImportPhotoOpen] = useState(false)
  const [whatIfOpen, setWhatIfOpen] = useState(false)

  const [termForm, setTermForm] = useState({
    schoolYear: defaultSchoolYear(),
    name: 'Term 1',
    position: 1,
  })

  const [gradeForm, setGradeForm] = useState({
    courseId: '',
    categoryId: '',
    scale: 'percentage' as GradeScale,
    gradeValue: '',
    weight: '1',
    gradedOn: new Date().toISOString().slice(0, 10),
    note: '',
  })
  const [targetForm, setTargetForm] = useState({
    scale: 'percentage' as GradeScale,
    targetValue: '85',
  })
  const [newCategoryForm, setNewCategoryForm] = useState({
    name: '',
    weight: '20',
    dropLowest: false,
  })
  const [whatIfForm, setWhatIfForm] = useState({
    categoryId: '',
    scale: 'percentage' as GradeScale,
    gradeValue: '',
    weight: '1',
  })
  const [importForm, setImportForm] = useState({
    scale: 'bulgarian' as GradeScale,
    rawText: '',
    gradedOn: new Date().toISOString().slice(0, 10),
  })
  const [photoImportForm, setPhotoImportForm] = useState({
    scale: 'bulgarian' as GradeScale,
    gradedOn: new Date().toISOString().slice(0, 10),
    file: null as File | null,
  })
  const [photoPreviewRows, setPhotoPreviewRows] = useState<Array<{
    key: string
    extractedCourseName: string
    courseId: string
    matchedCourseName: string
    gradeValue: string
    matchScore: number
    note: string
  }>>([])
  const [photoExtractMeta, setPhotoExtractMeta] = useState<{
    fileName: string
    source: 'api' | 'browser'
    parsedRows: number
    unparsedRows: number
  } | null>(null)

  const termsQuery = useQuery({
    queryKey: termsKey,
    queryFn: ({ signal }) => getTerms({}, signal),
  })
  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: ({ signal }) => getCourses(signal),
  })
  const gradesQuery = useQuery({
    queryKey: ['grades', selectedTermId],
    queryFn: ({ signal }) => getGrades({ termId: selectedTermId }, signal),
    enabled: Boolean(selectedTermId),
  })
  const gradeCategoriesQuery = useQuery({
    queryKey: ['grade-categories', selectedCourseId],
    queryFn: ({ signal }) => getGradeCategories({ courseId: selectedCourseId }, signal),
    enabled: Boolean(selectedCourseId),
  })
  const addGradeCategoriesQuery = useQuery({
    queryKey: ['grade-categories-for-add-grade', gradeForm.courseId],
    queryFn: ({ signal }) => getGradeCategories({ courseId: gradeForm.courseId }, signal),
    enabled: Boolean(gradeForm.courseId),
  })
  const summaryQuery = useQuery({
    queryKey: ['grades-summary', selectedTermId],
    queryFn: ({ signal }) => getGradesSummary(selectedTermId, signal),
    enabled: Boolean(selectedTermId),
  })
  const targetsQuery = useQuery({
    queryKey: ['grade-targets'],
    queryFn: ({ signal }) => getGradeTargets(signal),
  })
  const recommendationsQuery = useQuery({
    queryKey: ['study-recommendations', selectedTermId],
    queryFn: ({ signal }) => getStudyRecommendations({ termId: selectedTermId }, signal),
    enabled: Boolean(selectedTermId),
  })
  const academicRiskQuery = useQuery({
    queryKey: ['academic-risk', selectedTermId],
    queryFn: ({ signal }) => getAcademicRisk({ termId: selectedTermId }, signal),
    enabled: Boolean(selectedTermId),
  })
  const whatIfQuery = useQuery({
    queryKey: ['grades-what-if', selectedTermId, selectedCourseId, whatIfForm.categoryId, whatIfForm.scale, whatIfForm.gradeValue, whatIfForm.weight],
    queryFn: () =>
      getGradesWhatIf({
        termId: selectedTermId,
        courseId: selectedCourseId,
        categoryId: whatIfForm.categoryId,
        scale: whatIfForm.scale,
        gradeValue: Number(whatIfForm.gradeValue || '0'),
        weight: Number(whatIfForm.weight || '1'),
      }),
    enabled:
      whatIfOpen &&
      Boolean(selectedTermId) &&
      Boolean(selectedCourseId) &&
      Boolean(whatIfForm.categoryId) &&
      whatIfForm.gradeValue.trim().length > 0,
  })

  useEffect(() => {
    const terms = termsQuery.data ?? []
    if (!terms.length) return
    setSelectedTermId((current) => (current && terms.some((term) => term.id === current) ? current : terms[0].id))
  }, [termsQuery.data])

  const createTermMutation = useMutation({
    mutationFn: createTerm,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: termsKey }),
  })

  const deleteTermMutation = useMutation({
    mutationFn: deleteTerm,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: termsKey })
      await queryClient.invalidateQueries({ queryKey: ['grades'] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary'] })
    },
  })

  const createGradeMutation = useMutation({
    mutationFn: createGrade,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      setAddGradeOpen(false)
      setGradeForm((current) => ({ ...current, gradeValue: '', note: '' }))
    },
  })

  const deleteGradeMutation = useMutation({
    mutationFn: deleteGrade,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
    },
  })
  const createCategoryMutation = useMutation({
    mutationFn: createGradeCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grade-categories', selectedCourseId] })
      await queryClient.invalidateQueries({ queryKey: ['grade-categories-for-add-grade', selectedCourseId] })
      setNewCategoryForm({ name: '', weight: '20', dropLowest: false })
    },
  })
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string; weight?: number; dropLowest?: boolean } }) =>
      updateGradeCategory(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grade-categories', selectedCourseId] })
      await queryClient.invalidateQueries({ queryKey: ['grade-categories-for-add-grade', selectedCourseId] })
    },
  })
  const deleteCategoryMutation = useMutation({
    mutationFn: deleteGradeCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grade-categories', selectedCourseId] })
      await queryClient.invalidateQueries({ queryKey: ['grade-categories-for-add-grade', selectedCourseId] })
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
    },
  })
  const upsertTargetMutation = useMutation({
    mutationFn: ({ courseId, scale, targetValue }: { courseId: string; scale: GradeScale; targetValue: number }) =>
      upsertGradeTarget(courseId, { scale, targetValue }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grade-targets'] })
      queryClient.invalidateQueries({ queryKey: ['study-recommendations', selectedTermId] })
    },
  })
  const addRecommendationToPlannerMutation = useMutation({
    mutationFn: ({ courseId, minutes }: { courseId: string; minutes: number }) =>
      autoAddPlannerBlocks({
        courseId,
        totalMinutes: minutes,
        weekStartDate: getWeekStart().toISOString(),
      }),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
      queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      toast({
        variant: 'success',
        title: 'Added to Planner',
        description: `Added ${result.blocksCount} block${result.blocksCount === 1 ? '' : 's'} to ${result.dayLabels.join(' + ') || 'this week'}.`,
        actionLabel: result.blockIds.length ? 'Undo' : undefined,
        onAction: result.blockIds.length
          ? async () => {
              await Promise.all(result.blockIds.map((id) => deletePlannerBlock(id)))
              queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
              queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
              toast({
                variant: 'default',
                title: 'Auto-add undone',
              })
            }
          : undefined,
      })
    },
  })
  const scheduleRevisionMutation = useMutation({
    mutationFn: ({ courseId, courseName }: { courseId: string; courseName: string }) =>
      createOrganizationTask({
        title: `Revision: ${courseName}`,
        kind: 'exam',
        priority: 'high',
        courseId,
        dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      toast({ variant: 'success', title: 'Revision scheduled' })
    },
  })
  const createChecklistMutation = useMutation({
    mutationFn: ({ courseId, courseName, actions }: { courseId: string; courseName: string; actions: string[] }) =>
      createOrganizationTask({
        title: `Checklist: ${courseName}`,
        kind: 'task',
        priority: 'medium',
        courseId,
        subtasks: actions.slice(0, 3).map((title) => ({ title })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-tasks'] })
      toast({ variant: 'success', title: 'Checklist created' })
    },
  })
  const bulkImportMutation = useMutation({
    mutationFn: bulkImportGrades,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      setImportOpen(false)
      setImportForm((current) => ({ ...current, rawText: '' }))
      toast({
        variant: 'success',
        title: 'Grades imported',
        description: `Imported ${result.count} grade item${result.count === 1 ? '' : 's'}.`,
      })
    },
  })
  const photoExtractMutation = useMutation({
    mutationFn: async () => {
      if (!photoImportForm.file) return null
      const file = photoImportForm.file
      let source: 'api' | 'browser' = 'api'
      let ocrText = ''
      let fileName = file.name

      try {
        const ocr = await extractTextFromImage(file)
        ocrText = ocr.text
        fileName = ocr.fileName
      } catch {
        source = 'browser'
        const Tesseract = (await import('tesseract.js')).default
        const {
          data: { text },
        } = await Tesseract.recognize(file, 'eng')
        ocrText = text
      }

      const lines = ocrText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      const parsedRows = lines
        .map((line) => parseGradeSheetLine(line))
        .filter((row): row is { courseName: string; gradeValue: number } => row !== null)

      const unparsedRows = lines.length - parsedRows.length
      const matches = matchExtractedCoursesToUserCourses(
        parsedRows.map((item) => item.courseName),
        courses,
      )

      return {
        fileName,
        source,
        parsedRows,
        unparsedRows,
        matches,
      }
    },
    onSuccess: (result) => {
      if (!result) return
      setPhotoExtractMeta({
        fileName: result.fileName,
        source: result.source,
        parsedRows: result.parsedRows.length,
        unparsedRows: result.unparsedRows,
      })
      setPhotoPreviewRows(
        result.parsedRows.map((item, index) => {
          const match = result.matches[index]
          return {
            key: `${index}-${item.courseName}`,
            extractedCourseName: item.courseName,
            courseId: match?.matchedCourseId ?? '',
            matchedCourseName: match?.matchedCourseName ?? '',
            gradeValue: String(item.gradeValue),
            matchScore: match?.score ?? 0,
            note: '',
          }
        }),
      )

      if (result.parsedRows.length === 0) {
        toast({
          variant: 'error',
          title: 'No grade rows found',
          description: 'OCR finished, but no lines matched the expected format: CourseName GradeValue.',
        })
      }
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not extract text',
        description: 'OCR failed in both API and browser fallback.',
      })
    },
  })
  const photoImportSaveMutation = useMutation({
    mutationFn: bulkImportGrades,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      setImportPhotoOpen(false)
      setPhotoPreviewRows([])
      setPhotoImportForm((current) => ({ ...current, file: null }))
      setPhotoExtractMeta(null)
      toast({
        variant: 'success',
        title: 'Photo import complete',
        description: `Imported ${result.count} grade item${result.count === 1 ? '' : 's'}.`,
      })
    },
  })

  const terms = termsQuery.data ?? []
  const courses = coursesQuery.data ?? []
  const grades = gradesQuery.data ?? []
  const gradeCategories = gradeCategoriesQuery.data ?? []
  const addGradeCategories = addGradeCategoriesQuery.data ?? []
  const summary = summaryQuery.data
  const targets = targetsQuery.data ?? []
  const recommendations = recommendationsQuery.data ?? []
  const academicRisk = academicRiskQuery.data ?? []
  const riskByCourseId = useMemo(() => new Map(academicRisk.map((item) => [item.courseId, item])), [academicRisk])
  const selectedCourseGrades = useMemo(
    () =>
      grades
        .filter((item) => item.courseId === selectedCourseId)
        .slice()
        .sort((a, b) => new Date(b.gradedOn).getTime() - new Date(a.gradedOn).getTime()),
    [grades, selectedCourseId],
  )

  const selectedCourseAverage = useMemo(() => {
    if (!selectedCourseGrades.length) return null
    const totalWeight = selectedCourseGrades.reduce((sum, item) => sum + item.weight, 0)
    const weighted = selectedCourseGrades.reduce((sum, item) => sum + item.performanceScore * item.weight, 0)
    if (totalWeight <= 0) return null
    return weighted / totalWeight
  }, [selectedCourseGrades])

  const selectedCourseTrend = useMemo(() => {
    if (selectedCourseGrades.length < 2) return null
    const recent = selectedCourseGrades.slice(0, 5)
    const newest = recent[0].performanceScore
    const oldest = recent[recent.length - 1].performanceScore
    return newest - oldest
  }, [selectedCourseGrades])
  const selectedTarget = useMemo(
    () => targets.find((item) => item.courseId === selectedCourseId) ?? null,
    [selectedCourseId, targets],
  )
  const selectedCourseName = useMemo(
    () => courses.find((course) => course.id === selectedCourseId)?.name ?? '',
    [courses, selectedCourseId],
  )
  const categoryGradebookRows = useMemo(() => {
    return gradeCategories.map((category) => {
      const categoryItems = selectedCourseGrades.filter((item) => item.categoryId === category.id)
      const average = averageForCategory(categoryItems, category.dropLowest)
      return {
        ...category,
        averageScore: average == null ? null : Number(average.toFixed(2)),
        itemsCount: categoryItems.length,
      }
    })
  }, [gradeCategories, selectedCourseGrades])
  const selectedCourseOverallByCategory = useMemo(() => {
    const populated = categoryGradebookRows.filter((row) => row.averageScore != null && row.weight > 0)
    if (!populated.length) return selectedCourseAverage
    const totalWeight = populated.reduce((sum, row) => sum + row.weight, 0)
    if (totalWeight <= 0) return selectedCourseAverage
    const weighted = populated.reduce((sum, row) => sum + (row.averageScore ?? 0) * row.weight, 0)
    return weighted / totalWeight
  }, [categoryGradebookRows, selectedCourseAverage])

  useEffect(() => {
    if (!selectedTarget) return
    setTargetForm({
      scale: selectedTarget.scale,
      targetValue: String(selectedTarget.targetValue),
    })
  }, [selectedTarget])

  useEffect(() => {
    if (!gradeCategories.length) return
    setWhatIfForm((current) => ({
      ...current,
      categoryId:
        current.categoryId && gradeCategories.some((category) => category.id === current.categoryId)
          ? current.categoryId
          : gradeCategories[0]?.id ?? '',
    }))
  }, [gradeCategories])

  const importPreview = useMemo(() => {
    const lines = importForm.rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    return lines.map((line, index) => {
      const parsed = parseGradeSheetLine(line)
      if (!parsed) {
        return {
          key: `${index}-${line}`,
          raw: line,
          valid: false,
          error: 'Could not parse line',
        }
      }
      const [match] = matchExtractedCoursesToUserCourses([parsed.courseName], courses)
      if (!match?.matchedCourseId || !match.matchedCourseName) {
        return {
          key: `${index}-${line}`,
          raw: line,
          valid: false,
          error: 'Course not found',
        }
      }
      return {
        key: `${index}-${line}`,
        raw: line,
        valid: true,
        courseId: match.matchedCourseId,
        courseName: match.matchedCourseName,
        gradeValue: parsed.gradeValue,
      }
    })
  }, [courses, importForm.rawText])

  const canImport = importPreview.length > 0 && importPreview.every((item) => item.valid)
  const canImportFromPhoto =
    photoPreviewRows.length > 0 &&
    photoPreviewRows.every((row) => row.courseId && row.gradeValue.trim() && Number.isFinite(Number(row.gradeValue)))

  const onAddGrade = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedTermId || !gradeForm.courseId || !gradeForm.gradeValue.trim()) return
    createGradeMutation.mutate({
      termId: selectedTermId,
      courseId: gradeForm.courseId,
      categoryId: gradeForm.categoryId || null,
      scale: gradeForm.scale,
      gradeValue: Number(gradeForm.gradeValue),
      weight: Number(gradeForm.weight || '1'),
      gradedOn: gradeForm.gradedOn,
      note: gradeForm.note.trim() || undefined,
    })
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" />
            Grades
          </span>
        }
        subtitle="Track term grades by course across different grading scales with normalized performance insights."
        actions={(
          <>
            <Button variant="outline" onClick={() => setAddTermOpen(true)}>
              <CalendarPlus2 className="h-4 w-4" />
              Add term
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!selectedTermId}>
              Import grades
            </Button>
            <Button variant="outline" onClick={() => setImportPhotoOpen(true)} disabled={!selectedTermId}>
              Import from photo
            </Button>
            <Button onClick={() => setAddGradeOpen(true)} disabled={!selectedTermId}>
              <Plus className="h-4 w-4" />
              Add grade
            </Button>
          </>
        )}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <Card className="min-w-0 shadow-soft">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Term Gradebook</CardTitle>
                <CardDescription>Course | Grade | Weight | Date | Notes</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedTermId}
                  onChange={(event) => {
                    setSelectedTermId(event.target.value)
                    setSelectedCourseId('')
                  }}
                >
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.schoolYear} • {term.name}
                    </option>
                  ))}
                </select>
                {selectedTermId ? (
                  <Button variant="ghost" size="icon" onClick={() => deleteTermMutation.mutate(selectedTermId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-w-0">
            {grades.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
                No grades for this term yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Course</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grades.map((grade) => (
                      <TableRow
                        key={grade.id}
                        className={cn(selectedCourseId === grade.courseId && 'bg-primary/5')}
                        onClick={() => setSelectedCourseId(grade.courseId)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{grade.course?.name ?? grade.courseId}</span>
                            {riskByCourseId.get(grade.courseId)?.riskLevel && riskByCourseId.get(grade.courseId)?.riskLevel !== 'low' ? (
                              <Badge
                                variant={riskByCourseId.get(grade.courseId)?.riskLevel === 'high' ? 'default' : 'secondary'}
                                className={riskByCourseId.get(grade.courseId)?.riskLevel === 'high' ? 'bg-destructive/15 text-destructive' : undefined}
                              >
                                Needs attention
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{grade.category?.name ?? '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{formatGrade(grade.scale, grade.gradeValue)}</Badge>
                            <span className="text-xs text-muted-foreground">{grade.performanceScore.toFixed(1)} score</span>
                          </div>
                        </TableCell>
                        <TableCell>{grade.weight.toFixed(2)}</TableCell>
                        <TableCell>{new Date(grade.gradedOn).toLocaleDateString()}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">{grade.note ?? '-'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteGradeMutation.mutate(grade.id)
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-soft">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-primary" />
                Grades Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Overall average score: <span className="font-semibold">{formatScore(summary?.overallAverage)}</span></p>
              <p>
                Previous term: <span className="font-semibold">{formatScore(summary?.previousTermAverage)}</span>
                {summary?.deltaFromPrevious != null ? (
                  <span className={cn('ml-2 text-xs', summary.deltaFromPrevious >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                    {summary.deltaFromPrevious >= 0 ? '+' : ''}
                    {summary.deltaFromPrevious.toFixed(1)}
                  </span>
                ) : null}
              </p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best courses</p>
                <div className="mt-1 space-y-1">
                  {(summary?.bestCourses ?? []).map((course) => (
                    <p key={course.courseId} className="text-sm">
                      {course.courseName} <span className="text-muted-foreground">({course.averageScore.toFixed(1)})</span>
                    </p>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worst courses</p>
                <div className="mt-1 space-y-1">
                  {(summary?.worstCourses ?? []).map((course) => (
                    <p key={course.courseId} className="text-sm">
                      {course.courseName} <span className="text-muted-foreground">({course.averageScore.toFixed(1)})</span>
                    </p>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-soft">
            <CardHeader>
              <CardTitle className="text-base">Course Gradebook</CardTitle>
              <CardDescription>Select a course from the table for category-weighted averages and what-if preview.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Course</span>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm">
                Average score: <span className="font-semibold">{formatScore(selectedCourseOverallByCategory)}</span>
              </p>
              <p className="text-sm">
                Trend (last 5):{' '}
                <span className={cn('font-semibold', (selectedCourseTrend ?? 0) >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                  {selectedCourseTrend == null ? '-' : `${selectedCourseTrend >= 0 ? '+' : ''}${selectedCourseTrend.toFixed(1)}`}
                </span>
              </p>
              <div className="space-y-2">
                {selectedCourseId && categoryGradebookRows.length > 0 ? (
                  <div className="rounded-md border border-border/70 bg-background/70 p-2">
                    <div className="mb-2 grid grid-cols-[1.4fr_80px_90px_70px_36px] items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Category</span>
                      <span>Weight</span>
                      <span>Average</span>
                      <span>Drop low</span>
                      <span />
                    </div>
                    <div className="space-y-1.5">
                      {categoryGradebookRows.map((category) => (
                        <div key={category.id} className="grid grid-cols-[1.4fr_80px_90px_70px_36px] items-center gap-2">
                          <span className="truncate text-xs font-medium">{category.name}</span>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            defaultValue={String(category.weight)}
                            onBlur={(event) =>
                              updateCategoryMutation.mutate({
                                id: category.id,
                                payload: { weight: Number(event.target.value || '0') },
                              })
                            }
                          />
                          <span className="text-xs text-muted-foreground">{formatScore(category.averageScore)}</span>
                          <input
                            aria-label={`Drop lowest for ${category.name}`}
                            className="h-4 w-4 justify-self-center"
                            type="checkbox"
                            checked={category.dropLowest}
                            onChange={(event) =>
                              updateCategoryMutation.mutate({
                                id: category.id,
                                payload: { dropLowest: event.target.checked },
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => deleteCategoryMutation.mutate(category.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_auto_auto]">
                      <Input
                        placeholder="New category"
                        value={newCategoryForm.name}
                        onChange={(event) => setNewCategoryForm((current) => ({ ...current, name: event.target.value }))}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={newCategoryForm.weight}
                        onChange={(event) => setNewCategoryForm((current) => ({ ...current, weight: event.target.value }))}
                      />
                      <label className="flex items-center gap-2 rounded-md border border-border/70 px-2 text-xs">
                        <input
                          type="checkbox"
                          checked={newCategoryForm.dropLowest}
                          onChange={(event) => setNewCategoryForm((current) => ({ ...current, dropLowest: event.target.checked }))}
                        />
                        Drop low
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          createCategoryMutation.mutate({
                            courseId: selectedCourseId,
                            name: newCategoryForm.name.trim(),
                            weight: Number(newCategoryForm.weight || '0'),
                            dropLowest: newCategoryForm.dropLowest,
                          })
                        }
                        disabled={!selectedCourseId || !newCategoryForm.name.trim() || createCategoryMutation.isPending}
                      >
                        Add category
                      </Button>
                    </div>
                  </div>
                ) : null}
                {selectedCourseGrades.slice(0, 5).map((grade: GradeItemDto) => (
                  <div key={grade.id} className="rounded-md border border-border/70 bg-background/70 p-2 text-xs">
                    <p className="font-medium">
                      {formatGrade(grade.scale, grade.gradeValue)}
                      {grade.category?.name ? <span className="ml-1 text-muted-foreground">({grade.category.name})</span> : null}
                    </p>
                    <p className="text-muted-foreground">
                      {new Date(grade.gradedOn).toLocaleDateString()} • {grade.performanceScore.toFixed(1)} score
                    </p>
                  </div>
                ))}
                {selectedCourseGrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No course selected.</p>
                ) : null}
              </div>
              {selectedCourseId ? (
                <div className="rounded-md border border-border/70 bg-background/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target Grade</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={targetForm.scale}
                      onChange={(event) => setTargetForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                    >
                      <option value="percentage">Percentage</option>
                      <option value="german">German</option>
                      <option value="bulgarian">Bulgarian</option>
                    </select>
                    <Input
                      type="number"
                      step="0.1"
                      value={targetForm.targetValue}
                      onChange={(event) => setTargetForm((current) => ({ ...current, targetValue: event.target.value }))}
                    />
                    <Button
                      size="sm"
                      onClick={() =>
                        upsertTargetMutation.mutate({
                          courseId: selectedCourseId,
                          scale: targetForm.scale,
                          targetValue: Number(targetForm.targetValue || '0'),
                        })
                      }
                      disabled={upsertTargetMutation.isPending}
                    >
                      Save target
                    </Button>
                  </div>
                </div>
              ) : null}
              {selectedCourseId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWhatIfOpen(true)}
                  disabled={!gradeCategories.length}
                >
                  <Calculator className="h-4 w-4" />
                  What-if calculator
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-soft">
            <CardHeader>
              <CardTitle className="text-base">Needs Attention</CardTitle>
              <CardDescription>Recommendations from grades + recent study time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {recommendations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recommendations yet.</p>
              ) : (
                recommendations.slice(0, 5).map((item) => (
                  <div key={item.courseId} className="rounded-md border border-border/70 bg-background/70 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.courseName}</p>
                      <div className="flex items-center gap-1.5">
                        {riskByCourseId.get(item.courseId)?.riskLevel && riskByCourseId.get(item.courseId)?.riskLevel !== 'low' ? (
                          <Badge
                            variant={riskByCourseId.get(item.courseId)?.riskLevel === 'high' ? 'default' : 'secondary'}
                            className={riskByCourseId.get(item.courseId)?.riskLevel === 'high' ? 'bg-destructive/15 text-destructive' : undefined}
                          >
                            Needs attention
                          </Badge>
                        ) : null}
                        <Badge variant="outline">Attention {item.attentionScore}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Recommend {item.recommendedMinutes} min over next 7 days.
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {item.reasons.slice(0, 2).map((reason) => (
                        <p key={reason} className="text-xs text-muted-foreground">• {reason}</p>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        addRecommendationToPlannerMutation.mutate({
                          courseId: item.courseId,
                          minutes: item.recommendedMinutes,
                        })
                      }
                      disabled={addRecommendationToPlannerMutation.isPending}
                    >
                      ➕ Add {item.recommendedMinutes} min to plan
                    </Button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          scheduleRevisionMutation.mutate({
                            courseId: item.courseId,
                            courseName: item.courseName,
                          })
                        }
                        disabled={scheduleRevisionMutation.isPending}
                      >
                        Schedule revision
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          createChecklistMutation.mutate({
                            courseId: item.courseId,
                            courseName: item.courseName,
                            actions: riskByCourseId.get(item.courseId)?.suggestedActions ?? item.reasons,
                          })
                        }
                        disabled={createChecklistMutation.isPending}
                      >
                        Create checklist
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Dialog open={addTermOpen} onOpenChange={setAddTermOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Term</DialogTitle>
            <DialogDescription>Create a new term under a school year.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              createTermMutation.mutate(termForm, {
                onSuccess: () => setAddTermOpen(false),
              })
            }}
          >
            <label className="space-y-1.5">
              <span className="text-sm font-medium">School year</span>
              <Input
                value={termForm.schoolYear}
                onChange={(event) => setTermForm((current) => ({ ...current, schoolYear: event.target.value }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Term name</span>
              <Input
                value={termForm.name}
                onChange={(event) => setTermForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Position</span>
              <Input
                type="number"
                min={1}
                value={termForm.position}
                onChange={(event) => setTermForm((current) => ({ ...current, position: Math.max(1, Number(event.target.value) || 1) }))}
              />
            </label>
            <DialogFooter>
              <Button type="submit" disabled={createTermMutation.isPending}>
                Create term
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={addGradeOpen} onOpenChange={setAddGradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Grade</DialogTitle>
            <DialogDescription>Add a grade item for the selected term.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={onAddGrade}>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Course</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={gradeForm.courseId}
                onChange={(event) =>
                  setGradeForm((current) => ({ ...current, courseId: event.target.value, categoryId: '' }))
                }
              >
                <option value="">Select course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Category</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={gradeForm.categoryId}
                onChange={(event) => setGradeForm((current) => ({ ...current, categoryId: event.target.value }))}
                disabled={!gradeForm.courseId}
              >
                <option value="">No category</option>
                {addGradeCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Scale</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={gradeForm.scale}
                  onChange={(event) => setGradeForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                >
                  <option value="percentage">Percentage (0-100)</option>
                  <option value="german">German (1.0-6.0)</option>
                  <option value="bulgarian">Bulgarian (2-6)</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Grade</span>
                <Input
                  type="number"
                  step="0.01"
                  value={gradeForm.gradeValue}
                  onChange={(event) => setGradeForm((current) => ({ ...current, gradeValue: event.target.value }))}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Weight</span>
                <Input
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={gradeForm.weight}
                  onChange={(event) => setGradeForm((current) => ({ ...current, weight: event.target.value }))}
                />
              </label>
            </div>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Date</span>
              <Input
                type="date"
                value={gradeForm.gradedOn}
                onChange={(event) => setGradeForm((current) => ({ ...current, gradedOn: event.target.value }))}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Notes</span>
              <Textarea
                value={gradeForm.note}
                onChange={(event) => setGradeForm((current) => ({ ...current, note: event.target.value }))}
                rows={3}
              />
            </label>
            <DialogFooter>
              <Button type="submit" disabled={createGradeMutation.isPending}>
                Add grade
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import grades from text</DialogTitle>
            <DialogDescription>Paste one grade per line: `CourseName GradeValue`.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Scale</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={importForm.scale}
                  onChange={(event) => setImportForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                >
                  <option value="percentage">Percentage (0-100)</option>
                  <option value="german">German (1.0-6.0)</option>
                  <option value="bulgarian">Bulgarian (2-6)</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Date</span>
                <Input
                  type="date"
                  value={importForm.gradedOn}
                  onChange={(event) => setImportForm((current) => ({ ...current, gradedOn: event.target.value }))}
                />
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-sm font-medium">Paste text</span>
              <Textarea
                rows={8}
                placeholder={'Math 5.25\nGerman 4.50\nEnglish 5.75'}
                value={importForm.rawText}
                onChange={(event) => setImportForm((current) => ({ ...current, rawText: event.target.value }))}
              />
            </label>

            <div className="rounded-lg border border-border/70 bg-background/70 p-3">
              <p className="mb-2 text-sm font-medium">Preview</p>
              {importPreview.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lines parsed yet.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Course</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.map((item) => (
                        <TableRow key={item.key}>
                          <TableCell>{item.valid ? item.courseName : '-'}</TableCell>
                          <TableCell>{item.valid ? item.gradeValue : '-'}</TableCell>
                          <TableCell className={cn('text-xs', item.valid ? 'text-emerald-600' : 'text-destructive')}>
                            {item.valid ? 'OK' : item.error}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                bulkImportMutation.mutate({
                  termId: selectedTermId,
                  scale: importForm.scale,
                  gradedOn: importForm.gradedOn,
                  items: importPreview
                    .filter((item): item is { key: string; raw: string; valid: true; courseId: string; courseName: string; gradeValue: number } => item.valid)
                    .map((item) => ({
                      courseId: item.courseId,
                      gradeValue: item.gradeValue,
                      weight: 1,
                    })),
                })
              }
              disabled={!canImport || bulkImportMutation.isPending}
            >
              Import all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importPhotoOpen} onOpenChange={setImportPhotoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import grades from photo</DialogTitle>
            <DialogDescription>Upload a grade image, review extracted rows, edit, and confirm save.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Scale</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={photoImportForm.scale}
                  onChange={(event) => setPhotoImportForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                >
                  <option value="percentage">Percentage (0-100)</option>
                  <option value="german">German (1.0-6.0)</option>
                  <option value="bulgarian">Bulgarian (2-6)</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Date</span>
                <Input
                  type="date"
                  value={photoImportForm.gradedOn}
                  onChange={(event) => setPhotoImportForm((current) => ({ ...current, gradedOn: event.target.value }))}
                />
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-sm font-medium">Upload image</span>
              <Input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  {
                    setPhotoPreviewRows([])
                    setPhotoExtractMeta(null)
                    setPhotoImportForm((current) => ({
                      ...current,
                      file: event.target.files?.[0] ?? null,
                    }))
                  }
                }
              />
            </label>

            <Button
              variant="outline"
              onClick={() => photoExtractMutation.mutate()}
              disabled={!photoImportForm.file || photoExtractMutation.isPending}
            >
              Extract from photo
            </Button>

            {photoExtractMeta ? (
              <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                <p>
                  File: <span className="font-medium text-foreground">{photoExtractMeta.fileName}</span>
                </p>
                <p>
                  OCR source:{' '}
                  <span className="font-medium text-foreground">
                    {photoExtractMeta.source === 'api' ? 'Backend API' : 'Browser fallback'}
                  </span>
                </p>
                <p>
                  Parsed rows: <span className="font-medium text-foreground">{photoExtractMeta.parsedRows}</span>
                  {' · '}
                  Unparsed lines: <span className="font-medium text-foreground">{photoExtractMeta.unparsedRows}</span>
                </p>
              </div>
            ) : null}

            {photoPreviewRows.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Extracted</TableHead>
                      <TableHead>Matched course</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Match score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {photoPreviewRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <p className="text-xs">{row.extractedCourseName}</p>
                        </TableCell>
                        <TableCell>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                            value={row.courseId}
                            onChange={(event) =>
                              setPhotoPreviewRows((current) =>
                                current.map((item) =>
                                  item.key === row.key
                                    ? {
                                        ...item,
                                        courseId: event.target.value,
                                        matchedCourseName: courses.find((course) => course.id === event.target.value)?.name ?? '',
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <option value="">Match course...</option>
                            {courses.map((course) => (
                              <option key={course.id} value={course.id}>
                                {course.name}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={row.gradeValue}
                            onChange={(event) =>
                              setPhotoPreviewRows((current) =>
                                current.map((item) => (item.key === row.key ? { ...item, gradeValue: event.target.value } : item)),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {Math.round(row.matchScore * 100)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                photoImportSaveMutation.mutate({
                  termId: selectedTermId,
                  scale: photoImportForm.scale,
                  gradedOn: photoImportForm.gradedOn,
                  items: photoPreviewRows.map((row) => ({
                    courseId: row.courseId,
                    gradeValue: Number(row.gradeValue),
                    weight: 1,
                    note: row.note || undefined,
                  })),
                })
              }
              disabled={!canImportFromPhoto || photoImportSaveMutation.isPending}
            >
              Confirm import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={whatIfOpen} onOpenChange={setWhatIfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What-if Grade Calculator</DialogTitle>
            <DialogDescription>
              Simulate an upcoming grade for {selectedCourseName || 'the selected course'} and preview the resulting average.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Category</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={whatIfForm.categoryId}
                  onChange={(event) => setWhatIfForm((current) => ({ ...current, categoryId: event.target.value }))}
                >
                  <option value="">Select category</option>
                  {gradeCategories.map((category: GradeCategoryDto) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Scale</span>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={whatIfForm.scale}
                  onChange={(event) => setWhatIfForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                >
                  <option value="percentage">Percentage (0-100)</option>
                  <option value="german">German (1.0-6.0)</option>
                  <option value="bulgarian">Bulgarian (2-6)</option>
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Hypothetical grade</span>
                <Input
                  type="number"
                  step="0.01"
                  value={whatIfForm.gradeValue}
                  onChange={(event) => setWhatIfForm((current) => ({ ...current, gradeValue: event.target.value }))}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">Weight</span>
                <Input
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={whatIfForm.weight}
                  onChange={(event) => setWhatIfForm((current) => ({ ...current, weight: event.target.value }))}
                />
              </label>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-3 text-sm">
              <p>
                Current average: <span className="font-semibold">{formatScore(whatIfQuery.data?.currentAverage)}</span>
              </p>
              <p>
                Resulting average: <span className="font-semibold">{formatScore(whatIfQuery.data?.resultingAverage)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Delta: {whatIfQuery.data?.delta == null ? '-' : `${whatIfQuery.data.delta >= 0 ? '+' : ''}${whatIfQuery.data.delta.toFixed(2)}`}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
