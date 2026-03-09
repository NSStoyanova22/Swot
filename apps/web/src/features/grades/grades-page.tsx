import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Calculator, CalendarPlus2, Check, GraduationCap, Pencil, Plus, Trash2, X } from 'lucide-react'

import { createCourse, getCourses, updateCourse } from '@/api/courses'
import { getMe, updatePreferences } from '@/api/me'
import { autoAddPlannerBlocks, deletePlannerBlock } from '@/api/planner'
import { createOrganizationTask } from '@/api/organization'
import { bulkImportGrades, createGrade, createGradeCategory, createTerm, deleteAllGradesForTerm, deleteGrade, deleteGradeCategory, deleteTerm, extractTextFromImage, getAcademicRisk, getCelebrationState, getGradeCategories, getGradeTargets, getGrades, getGradesSummary, getGradesWhatIf, getTerms, importShkoloPdf, recordCelebration, updateGrade, updateGradeCategory, upsertGradeTarget } from '@/api/grades'
import type { GradeCategoryDto, GradeItemDto, GradeScale, UpdatePreferencesDto } from '@/api/dtos'
import { PageContainer, PageHeader } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { GradeChip } from '@/features/grades/GradeChip'
import { canTriggerCelebrationCooldown, getCelebrationCooldownLastAt, markCelebrationCooldown } from '@/features/celebration/celebration-cooldown'
import { notifyCelebration } from '@/features/celebration/celebration-events'
import { matchExtractedCoursesToUserCourses } from '@/features/grades/course-matching'
import { parseGradeSheetLine } from '@/features/grades/parse-grade-sheet'
import { SubjectGradeTable } from '@/features/grades/SubjectGradeTable'
import { gradeToNormalizedScore } from '@/features/grades/grade-colors'
import { cn } from '@/lib/utils'

const termsKey = ['terms'] as const
const weekdays = [1, 2, 3, 4, 5, 6, 7] as const
const SHKOLO_UNMATCHED_THRESHOLD = 0.55

function defaultSchoolYear() {
  const now = new Date()
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}/${String(year + 1).slice(2)}`
}

function formatScore(value: number | null | undefined) {
  if (value == null) return '-'
  return `${value.toFixed(1)}`
}

function formatAverageValue(scale: GradeScale, value: number | null | undefined) {
  if (value == null) return '-'
  if (scale === 'percentage') return `${value.toFixed(1)}`
  return value.toFixed(2)
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

function parseOptionalNumber(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseGradeListText(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((item) => parseOptionalNumber(item))
    .filter((item): item is number => item != null)
}

function isExcellentTermFinal(scale: GradeScale, value: number) {
  if (scale === 'bulgarian') return value >= 5.75 || Math.abs(value - 6) < 0.001
  if (scale === 'german') return value <= 1.5 || gradeToNormalizedScore(scale, value) >= 90
  return value >= 90
}

function buildMatchTooltip(debug: {
  normalizedExtracted: string
  normalizedCandidate: string
  levenshteinDistance: number
  tokenScore: number
  charScore: number
  overlapBonus: number
  threshold: number
  formula: string
} | null) {
  if (!debug) return 'No match diagnostics available.'
  return [
    `normalizedExtracted: ${debug.normalizedExtracted || '-'}`,
    `normalizedCandidate: ${debug.normalizedCandidate || '-'}`,
    `levenshteinDistance: ${debug.levenshteinDistance}`,
    `tokenScore: ${debug.tokenScore.toFixed(3)}`,
    `charScore: ${debug.charScore.toFixed(3)}`,
    `overlapBonus: ${debug.overlapBonus.toFixed(3)}`,
    `threshold: ${debug.threshold.toFixed(2)}`,
    debug.formula,
  ].join('\n')
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
  const [deleteTermGradesConfirmOpen, setDeleteTermGradesConfirmOpen] = useState(false)
  const [deleteTermGradesConfirmText, setDeleteTermGradesConfirmText] = useState('')
  const [summaryDisplayScale, setSummaryDisplayScale] = useState<GradeScale>('bulgarian')
  const [includeTermGradeInAverage, setIncludeTermGradeInAverage] = useState(false)

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
  const [importMode, setImportMode] = useState<'text' | 'shkolo-pdf'>('text')
  const [editingCourseNameId, setEditingCourseNameId] = useState<string | null>(null)
  const [editingCourseNameValue, setEditingCourseNameValue] = useState('')
  const [photoImportForm, setPhotoImportForm] = useState({
    scale: 'bulgarian' as GradeScale,
    gradedOn: new Date().toISOString().slice(0, 10),
    file: null as File | null,
  })
  const [shkoloForm, setShkoloForm] = useState({
    scale: 'bulgarian' as GradeScale,
    gradedOn: new Date().toISOString().slice(0, 10),
    file: null as File | null,
    targetTermId: '',
    termGradeSource: 'term1' as 'term1' | 'term2',
    includeCurrentGrades: true,
  })
  const [showShkoloDebug, setShowShkoloDebug] = useState(false)
  const [shkoloMeta, setShkoloMeta] = useState<{
    fileName: string
    detectedYear: string | null
    subjectsFound: number
    parsedRows: number
    currentGradesCount: number
    termGradesFoundCount: number
    skippedLines: number
    parseWarnings: string[]
    debug?: {
      rawSamples: string[]
      pagesText?: Array<{
        page: number
        text: string
      }>
      pageItems?: Record<string, Array<{
        page: number
        str: string
        x: number
        y: number
        width: number
        height: number
      }>>
      usedOcrFallback: boolean
      scannedThreshold: number
      totalExtractedLength: number
      extractedPageTextLengths: Array<{
        page: number
        length: number
      }>
      ocrPageTextLengths: Array<{
        page: number
        general: number
        digits: number
        total: number
      }>
    }
  } | null>(null)
  const [shkoloPreviewRows, setShkoloPreviewRows] = useState<Array<{
    key: string
    subjectName: string
    courseId: string
    matchedCourseName: string
    matchScore: number
    matchDebug: {
      normalizedExtracted: string
      normalizedCandidate: string
      levenshteinDistance: number
      tokenScore: number
      charScore: number
      overlapBonus: number
      threshold: number
      formula: string
    } | null
    term1Final: string
    term2Final: string
    yearFinal: string
    term1Current: string
    term2Current: string
    rawRowText: string
    parseWarnings: string[]
  }>>([])
  const [shkoloCreateCourseRowKey, setShkoloCreateCourseRowKey] = useState<string | null>(null)
  const [shkoloCreateCourseName, setShkoloCreateCourseName] = useState('')
  const [shkoloEditingSubjectRowKey, setShkoloEditingSubjectRowKey] = useState<string | null>(null)
  const [shkoloEditingSubjectValue, setShkoloEditingSubjectValue] = useState('')
  const [shkoloMoveGradeDialog, setShkoloMoveGradeDialog] = useState<{
    fromRowKey: string
    sourceField: 'term1Current' | 'term2Current'
    gradeIndex: number
    gradeValue: number
  } | null>(null)
  const [shkoloMoveGradeTargetRowKey, setShkoloMoveGradeTargetRowKey] = useState<string>('')
  const [shkoloSaveConfirmOpen, setShkoloSaveConfirmOpen] = useState(false)
  const [shkoloRemovedRowsCount, setShkoloRemovedRowsCount] = useState(0)
  const [shkoloRemoveRowKey, setShkoloRemoveRowKey] = useState<string | null>(null)
  const [shkoloAlwaysIgnoreSubject, setShkoloAlwaysIgnoreSubject] = useState(false)
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

  const openShkoloCreateCourseDialog = (rowKey: string, initialName: string) => {
    setShkoloCreateCourseRowKey(rowKey)
    setShkoloCreateCourseName(initialName)
  }

  const closeShkoloCreateCourseDialog = () => {
    setShkoloCreateCourseRowKey(null)
    setShkoloCreateCourseName('')
  }

  const serializeGradeList = (values: number[]) => values.map((value) => String(value)).join(', ')

  const updateShkoloCurrentGrades = (
    rowKey: string,
    field: 'term1Current' | 'term2Current',
    updater: (values: number[]) => number[],
  ) => {
    setShkoloPreviewRows((current) =>
      current.map((row) => {
        if (row.key !== rowKey) return row
        const next = updater(parseGradeListText(row[field]))
        return {
          ...row,
          [field]: serializeGradeList(next),
        }
      }),
    )
  }

  const startShkoloMoveGrade = (
    fromRowKey: string,
    sourceField: 'term1Current' | 'term2Current',
    gradeIndex: number,
    gradeValue: number,
  ) => {
    setShkoloMoveGradeDialog({
      fromRowKey,
      sourceField,
      gradeIndex,
      gradeValue,
    })
    setShkoloMoveGradeTargetRowKey('')
  }

  const downloadShkoloDebugJson = () => {
    if (!shkoloMeta?.debug) return
    const payload = {
      fileName: shkoloMeta.fileName,
      debug: shkoloMeta.debug,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `shkolo-debug-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buildPreferencesPayload = (ignoredShkoloSubjects: string[]): UpdatePreferencesDto | null => {
    const me = meQuery.data
    if (!me) return null
    const targetByWeekday = new Map(me.targets.map((item) => [item.weekday, item.targetMinutes]))

    return {
      settings: {
        cutoffTime: me.settings?.cutoffTime ?? '05:00',
        soundsEnabled: me.settings?.soundsEnabled ?? true,
        shortSessionMinutes: me.settings?.shortSessionMinutes ?? 10,
        longSessionMinutes: me.settings?.longSessionMinutes ?? 50,
        breakSessionMinutes: me.settings?.breakSessionMinutes ?? 25,
        adaptiveEnabled: me.settings?.adaptiveEnabled ?? true,
        riskEnabled: me.settings?.riskEnabled ?? true,
        riskThresholdMode: me.settings?.riskThresholdMode ?? 'score',
        riskScoreThreshold: me.settings?.riskScoreThreshold ?? 70,
        riskGradeThresholdByScale: {
          bulgarian: me.settings?.riskGradeThresholdByScale?.bulgarian ?? 4.5,
          german: me.settings?.riskGradeThresholdByScale?.german ?? 3.5,
          percentage: me.settings?.riskGradeThresholdByScale?.percentage ?? 70,
        },
        riskLookback: me.settings?.riskLookback ?? 'currentTerm',
        riskMinDataPoints: me.settings?.riskMinDataPoints ?? 2,
        riskUseTermFinalIfAvailable: me.settings?.riskUseTermFinalIfAvailable ?? true,
        riskShowOnlyIfBelowThreshold: me.settings?.riskShowOnlyIfBelowThreshold ?? true,
        celebrationEnabled: me.settings?.celebrationEnabled ?? true,
        celebrationScoreThreshold: me.settings?.celebrationScoreThreshold ?? 90,
        celebrationCooldownHours: me.settings?.celebrationCooldownHours ?? 24,
        celebrationShowFor: me.settings?.celebrationShowFor ?? 'all',
      },
      targets: weekdays.map((weekday) => ({
        weekday,
        targetMinutes: targetByWeekday.get(weekday) ?? 90,
      })),
      uiPreferences: me.uiPreferences,
      ignoredShkoloSubjects,
    }
  }

  const rematchShkoloRow = (rowKey: string, extractedSubject: string) => {
    const [match] = matchExtractedCoursesToUserCourses([extractedSubject], courses, {
      threshold: SHKOLO_UNMATCHED_THRESHOLD,
    })
    setShkoloPreviewRows((current) =>
      current.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              courseId: match?.matchedCourseId ?? '',
              matchedCourseName: match?.matchedCourseName ?? '',
              matchScore: match?.score ?? 0,
              matchDebug: match?.debug ?? null,
            }
          : row,
      ),
    )
  }

  const removeShkoloRow = (rowKey: string) => {
    setShkoloRemoveRowKey(rowKey)
    setShkoloAlwaysIgnoreSubject(false)
  }

  const saveShkoloSubjectNameEdit = (rowKey: string) => {
    const nextName = shkoloEditingSubjectValue.trim()
    if (!nextName) return
    setShkoloPreviewRows((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, subjectName: nextName } : row)),
    )
    rematchShkoloRow(rowKey, nextName)
    setShkoloEditingSubjectRowKey(null)
    setShkoloEditingSubjectValue('')
  }

  const confirmShkoloMoveGrade = () => {
    const moving = shkoloMoveGradeDialog
    if (!moving || !shkoloMoveGradeTargetRowKey) return
    if (moving.fromRowKey === shkoloMoveGradeTargetRowKey) {
      setShkoloMoveGradeDialog(null)
      setShkoloMoveGradeTargetRowKey('')
      return
    }

    updateShkoloCurrentGrades(moving.fromRowKey, moving.sourceField, (values) =>
      values.filter((_, index) => index !== moving.gradeIndex),
    )
    updateShkoloCurrentGrades(shkoloMoveGradeTargetRowKey, moving.sourceField, (values) => [
      ...values,
      moving.gradeValue,
    ])

    setShkoloMoveGradeDialog(null)
    setShkoloMoveGradeTargetRowKey('')
  }

  const confirmRemoveShkoloRow = async () => {
    if (!shkoloRemoveRowKey) return
    const row = shkoloPreviewRows.find((item) => item.key === shkoloRemoveRowKey)
    if (!row) {
      setShkoloRemoveRowKey(null)
      setShkoloAlwaysIgnoreSubject(false)
      return
    }

    if (shkoloCreateCourseRowKey === row.key) {
      closeShkoloCreateCourseDialog()
    }

    if (shkoloAlwaysIgnoreSubject) {
      const existing = meQuery.data?.ignoredShkoloSubjects ?? []
      const merged = Array.from(
        new Set([...existing, row.subjectName.trim()].filter(Boolean).map((item) => item.trim())),
      )
      try {
        await saveIgnoredShkoloSubjectsMutation.mutateAsync(merged)
      } catch {
        toast({
          variant: 'error',
          title: 'Could not save ignore rule',
          description: 'Subject will be removed from this import only.',
        })
      }
    }

    setShkoloPreviewRows((current) => current.filter((item) => item.key !== row.key))
    setShkoloRemovedRowsCount((count) => count + 1)
    setShkoloRemoveRowKey(null)
    setShkoloAlwaysIgnoreSubject(false)
  }

  const termsQuery = useQuery({
    queryKey: termsKey,
    queryFn: ({ signal }) => getTerms({}, signal),
  })
  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: ({ signal }) => getCourses(signal),
  })
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
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
    queryKey: ['grades-summary', selectedTermId, summaryDisplayScale, includeTermGradeInAverage],
    queryFn: ({ signal }) =>
      getGradesSummary(
        selectedTermId,
        {
          displayScale: summaryDisplayScale,
          includeTermGrade: includeTermGradeInAverage,
        },
        signal,
      ),
    enabled: Boolean(selectedTermId),
  })
  const targetsQuery = useQuery({
    queryKey: ['grade-targets'],
    queryFn: ({ signal }) => getGradeTargets(signal),
  })
  const academicRiskQuery = useQuery({
    queryKey: [
      'academic-risk',
      selectedTermId,
      summaryDisplayScale,
      includeTermGradeInAverage,
      meQuery.data?.settings?.riskEnabled,
      meQuery.data?.settings?.riskThresholdMode,
      meQuery.data?.settings?.riskScoreThreshold,
      meQuery.data?.settings?.riskLookback,
      meQuery.data?.settings?.riskMinDataPoints,
      meQuery.data?.settings?.riskUseTermFinalIfAvailable,
      meQuery.data?.settings?.riskShowOnlyIfBelowThreshold,
      meQuery.data?.settings?.riskGradeThresholdByScale?.bulgarian,
      meQuery.data?.settings?.riskGradeThresholdByScale?.german,
      meQuery.data?.settings?.riskGradeThresholdByScale?.percentage,
    ],
    queryFn: ({ signal }) =>
      getAcademicRisk(
        {
          termId: selectedTermId,
          displayScale: summaryDisplayScale,
          includeTermGrade: includeTermGradeInAverage,
        },
        signal,
      ),
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
  const celebrationStateQuery = useQuery({
    queryKey: ['celebrations-state'],
    queryFn: ({ signal }) => getCelebrationState(signal),
  })

  const getCourseAverageScoreMap = (items: GradeItemDto[]) => {
    const byCourse = new Map<string, { weighted: number; totalWeight: number }>()
    for (const item of items) {
      const weight = Math.max(0.05, Number(item.weight || 1))
      const current = byCourse.get(item.courseId) ?? { weighted: 0, totalWeight: 0 }
      current.weighted += Number(item.performanceScore) * weight
      current.totalWeight += weight
      byCourse.set(item.courseId, current)
    }
    return new Map(
      Array.from(byCourse.entries()).map(([courseId, value]) => [
        courseId,
        value.totalWeight > 0 ? value.weighted / value.totalWeight : 0,
      ]),
    )
  }

  const canTriggerCelebration = (
    type: 'gradeItem' | 'termFinal' | 'courseAverage',
    courseId: string,
    score: number,
  ) => {
    const settings = meQuery.data?.settings
    const state = celebrationStateQuery.data
    if (!(settings?.celebrationEnabled ?? true)) return false
    const threshold = settings?.celebrationScoreThreshold ?? 90
    if (!Number.isFinite(score) || score < threshold) return false
    const showFor = settings?.celebrationShowFor ?? 'all'
    if (showFor !== 'all' && showFor !== type) return false
    const cooldownHours = settings?.celebrationCooldownHours ?? 24
    const record = state?.records.find((item) => item.courseId === courseId)
    const persistedAt = record?.lastCelebratedAt ? new Date(record.lastCelebratedAt).getTime() : 0
    const localAt = getCelebrationCooldownLastAt(`course:${courseId}`)
    const lastAt = Math.max(persistedAt, localAt)
    if (!lastAt) return true
    return canTriggerCelebrationCooldown(`course:${courseId}`, cooldownHours)
  }

  const triggerCelebration = async (payload: {
    type: 'gradeItem' | 'termFinal' | 'courseAverage'
    courseId: string
    score: number
    gradeValue?: number | null
    termId?: string
    message?: string
  }) => {
    if (!canTriggerCelebration(payload.type, payload.courseId, payload.score)) return
    const courseName =
      courses.find((course) => course.id === payload.courseId)?.name ?? payload.courseId
    notifyCelebration({
      ...payload,
      courseName,
    })
    markCelebrationCooldown(`course:${payload.courseId}`)
    await recordCelebration({
      courseId: payload.courseId,
      score: payload.score,
      type: payload.type,
    })
    queryClient.invalidateQueries({ queryKey: ['celebrations-state'] })
  }

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
  const deleteTermGradesMutation = useMutation({
    mutationFn: deleteAllGradesForTerm,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['study-recommendations', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['academic-risk', selectedTermId] })
      setDeleteTermGradesConfirmOpen(false)
      setDeleteTermGradesConfirmText('')
      toast({
        variant: 'success',
        title: 'Term grades deleted',
        description: `Deleted ${result.deletedCount} grade item${result.deletedCount === 1 ? '' : 's'}.`,
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not delete term grades',
      })
    },
  })

  const createGradeMutation = useMutation({
    mutationFn: createGrade,
    onSuccess: async (created) => {
      const beforeAverage = currentCourseAverageScoreMap.get(created.courseId) ?? null
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      const refreshed = await getGrades({ termId: selectedTermId })
      const afterAverage = getCourseAverageScoreMap(refreshed).get(created.courseId) ?? null
      setAddGradeOpen(false)
      setGradeForm((current) => ({ ...current, gradeValue: '', note: '' }))

      const itemScore = gradeToNormalizedScore(created.scale, created.gradeValue)
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
      const eligibleByType = created.isFinal
        ? itemScore >= threshold && isExcellentTermFinal(created.scale, created.gradeValue)
        : itemScore >= threshold
      if (eligibleByType) {
        await triggerCelebration({
          type: created.isFinal ? 'termFinal' : 'gradeItem',
          courseId: created.courseId,
          score: itemScore,
          gradeValue: created.gradeValue,
          termId: created.termId,
          message: created.isFinal ? 'Excellent final grade recorded.' : 'Excellent grade added.',
        })
      }

      if (beforeAverage != null && afterAverage != null) {
        if (beforeAverage < threshold && afterAverage >= threshold) {
          await triggerCelebration({
            type: 'courseAverage',
            courseId: created.courseId,
            score: afterAverage,
            termId: created.termId,
            message: 'Course average crossed your excellence threshold.',
          })
        }
      }
    },
  })
  const updateCourseMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCourse(id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['study-recommendations', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['academic-risk', selectedTermId] })
      setEditingCourseNameId(null)
      setEditingCourseNameValue('')
      toast({
        variant: 'success',
        title: 'Course renamed',
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not rename course',
      })
    },
  })

  const deleteGradeMutation = useMutation({
    mutationFn: deleteGrade,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      toast({
        variant: 'success',
        title: 'Grade deleted',
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not delete grade',
      })
    },
  })
  const updateGradeMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateGrade>[1] }) =>
      updateGrade(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      toast({
        variant: 'success',
        title: 'Grade updated',
      })
    },
  })
  const deleteManyGradesMutation = useMutation({
    mutationFn: async (ids: string[]) => Promise.all(ids.map((id) => deleteGrade(id))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      toast({
        variant: 'success',
        title: 'Grades deleted',
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not delete grades',
      })
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
    onMutate: async (payload) => {
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
      const preparedItems = payload.items
        .map((item) => {
          const score = gradeToNormalizedScore(payload.scale, item.gradeValue)
          const isTermFinalItem = Boolean(item.isFinal)
          const excellentFinal = isTermFinalItem && isExcellentTermFinal(payload.scale, item.gradeValue)
          if (isTermFinalItem) {
            if (!(score >= threshold && excellentFinal)) return null
          } else if (score < threshold) {
            return null
          }
          return {
            courseId: item.courseId,
            score,
            gradeValue: item.gradeValue,
            type: (isTermFinalItem ? 'termFinal' : 'gradeItem') as 'gradeItem' | 'termFinal',
          }
        })
        .filter((item): item is { courseId: string; score: number; gradeValue: number; type: 'gradeItem' | 'termFinal' } => item != null)
      lastBulkImportContextRef.current = {
        beforeAverageMap: new Map(currentCourseAverageScoreMap),
        items: preparedItems,
      }
    },
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      setImportOpen(false)
      setImportForm((current) => ({ ...current, rawText: '' }))
      toast({
        variant: 'success',
        title: 'Grades imported',
        description: `Imported ${result.count} grade item${result.count === 1 ? '' : 's'}.`,
      })

      const context = lastBulkImportContextRef.current
      lastBulkImportContextRef.current = null
      if (!context || !context.items.length) return

      const refreshed = await getGrades({ termId: variables.termId })
      const afterAverageMap = getCourseAverageScoreMap(refreshed)
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
      const crossingCandidates = Array.from(
        new Set(context.items.map((item) => item.courseId)),
      )
        .map((courseId) => {
          const before = context.beforeAverageMap.get(courseId)
          const after = afterAverageMap.get(courseId)
          if (before == null || after == null) return null
          if (before < threshold && after >= threshold) {
            return {
              type: 'courseAverage' as const,
              courseId,
              score: after,
              gradeValue: null,
              delta: after - before,
            }
          }
          return null
        })
        .filter((item): item is { type: 'courseAverage'; courseId: string; score: number; gradeValue: null; delta: number } => item != null)

      const itemCandidates = context.items.map((item) => ({
        ...item,
        delta: 0,
      }))
      const best = [...itemCandidates, ...crossingCandidates].sort((a, b) => {
        if (b.delta !== a.delta) return b.delta - a.delta
        return b.score - a.score
      })[0]
      if (!best) return
      await triggerCelebration({
        type: best.type,
        courseId: best.courseId,
        score: best.score,
        gradeValue: best.gradeValue,
        termId: variables.termId,
      })
    },
  })
  const createShkoloCourseMutation = useMutation({
    mutationFn: async (payload: { rowKey: string; name: string }) => {
      const created = await createCourse({ name: payload.name.trim() })
      return { rowKey: payload.rowKey, created }
    },
    onSuccess: async ({ rowKey, created }) => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      setShkoloPreviewRows((current) =>
        current.map((row) =>
          row.key === rowKey
            ? {
                ...row,
                courseId: created.id,
                matchedCourseName: created.name,
                matchScore: 1,
                matchDebug: {
                  normalizedExtracted: row.subjectName.normalize('NFKD').toLowerCase(),
                  normalizedCandidate: created.name.normalize('NFKD').toLowerCase(),
                  levenshteinDistance: 0,
                  tokenScore: 1,
                  charScore: 1,
                  overlapBonus: 0,
                  threshold: SHKOLO_UNMATCHED_THRESHOLD,
                  formula: 'manually created course assigned',
                },
              }
            : row,
        ),
      )
      if (shkoloCreateCourseRowKey === rowKey) {
        closeShkoloCreateCourseDialog()
      }
      toast({
        variant: 'success',
        title: 'Course created',
        description: `${created.name} was created and assigned.`,
      })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: 'Could not create course',
        description: 'Check the course name and try again.',
      })
    },
  })
  const saveIgnoredShkoloSubjectsMutation = useMutation({
    mutationFn: async (subjects: string[]) => {
      const payload = buildPreferencesPayload(subjects)
      if (!payload) throw new Error('Could not load user preferences.')
      return updatePreferences(payload)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated)
    },
  })
  const shkoloExtractMutation = useMutation({
    mutationFn: async () => {
      if (!shkoloForm.file) return null
      return importShkoloPdf(shkoloForm.file, { debug: showShkoloDebug })
    },
    onSuccess: (result) => {
      if (!result) return

      setShkoloRemovedRowsCount(0)
      closeShkoloCreateCourseDialog()
      setShkoloEditingSubjectRowKey(null)
      setShkoloEditingSubjectValue('')
      setShkoloMoveGradeDialog(null)
      setShkoloMoveGradeTargetRowKey('')
      setShkoloSaveConfirmOpen(false)
      setShkoloRemoveRowKey(null)
      setShkoloAlwaysIgnoreSubject(false)
      const matches = matchExtractedCoursesToUserCourses(
        result.rows.map((row) => row.extractedSubject),
        courses,
        { threshold: SHKOLO_UNMATCHED_THRESHOLD },
      )

      const currentGradesCount = result.rows.reduce((sum, row) => sum + row.currentGrades.length, 0)
      const termGradesFoundCount = result.rows.reduce(
        (sum, row) =>
          sum +
          ((row.t1FinalGrade ?? row.term1) == null ? 0 : 1) +
          ((row.t2FinalGrade ?? row.term2) == null ? 0 : 1) +
          (row.yearFinalGrade == null ? 0 : 1),
        0,
      )

      setShkoloMeta({
        fileName: result.fileName,
        detectedYear: result.detectedYear,
        subjectsFound: result.rows.length,
        parsedRows: result.rows.length,
        currentGradesCount,
        termGradesFoundCount,
        skippedLines: result.skippedLines,
        parseWarnings: result.parseWarnings ?? [],
        debug: result.debug,
      })

      setShkoloPreviewRows(
        result.rows.map((row, index) => {
          const match = matches[index]
          return {
            key: `${index}-${row.extractedSubject}`,
            subjectName: row.extractedSubject,
            courseId: match?.matchedCourseId ?? '',
            matchedCourseName: match?.matchedCourseName ?? '',
            matchScore: match?.score ?? 0,
            matchDebug: match?.debug ?? null,
            term1Final: row.t1FinalGrade == null ? (row.term1 == null ? '' : String(row.term1)) : String(row.t1FinalGrade),
            term2Final: row.t2FinalGrade == null ? (row.term2 == null ? '' : String(row.term2)) : String(row.t2FinalGrade),
            yearFinal: row.yearFinalGrade == null ? '' : String(row.yearFinalGrade),
            term1Current: (row.t1CurrentGrades ?? row.currentGrades).join(', '),
            term2Current: (row.t2CurrentGrades ?? []).join(', '),
            rawRowText: row.rawRowText ?? '',
            parseWarnings: row.parseWarnings ?? [],
          }
        }),
      )
    },
  })
  const shkoloImportSaveMutation = useMutation({
    mutationFn: async () => {
      if (!shkoloForm.targetTermId) return 0
      const beforeAverageMap = new Map(currentCourseAverageScoreMap)

      const categoryCache = new Map<string, { currentId: string; termGradeId: string }>()
      const importMetadata = {
        importType: 'shkoloPdf',
        fileName: shkoloMeta?.fileName ?? shkoloForm.file?.name ?? 'shkolo.pdf',
        importedAt: new Date().toISOString(),
      }

      const ensureCategoryId = async (courseId: string, categoryName: 'Current' | 'Term grade') => {
        const existing = await getGradeCategories({ courseId })
        const found = existing.find((category) => category.name.trim().toLowerCase() === categoryName.toLowerCase())
        if (found) return found.id

        const created = await createGradeCategory({
          courseId,
          name: categoryName,
          weight: categoryName === 'Term grade' ? 30 : 20,
          dropLowest: false,
        })
        return created.id
      }

      const getCategoryIds = async (courseId: string) => {
        const cached = categoryCache.get(courseId)
        if (cached) return cached

        const currentId = await ensureCategoryId(courseId, 'Current')
        const termGradeId = await ensureCategoryId(courseId, 'Term grade')
        const value = { currentId, termGradeId }
        categoryCache.set(courseId, value)
        return value
      }

      const items: Array<{
        courseId: string
        categoryId?: string | null
        gradeValue: number
        weight: number
        note?: string
        isFinal?: boolean
        finalType?: 'TERM1' | 'TERM2' | 'YEAR' | null
        importMetadata?: Record<string, unknown> | null
      }> = []
      const celebrationCandidates: Array<{
        courseId: string
        score: number
        gradeValue: number
        type: 'gradeItem' | 'termFinal'
      }> = []
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90

      for (const row of shkoloPreviewRows) {
        if (!row.courseId) continue
        const { currentId, termGradeId } = await getCategoryIds(row.courseId)

        if (shkoloForm.includeCurrentGrades) {
          const currentValues = [...parseGradeListText(row.term1Current), ...parseGradeListText(row.term2Current)]
          for (const value of currentValues) {
            items.push({
              courseId: row.courseId,
              categoryId: currentId,
              gradeValue: value,
              weight: 1,
              note: 'Shkolo current grade',
              isFinal: false,
              importMetadata,
            })
            const score = gradeToNormalizedScore(shkoloForm.scale, value)
            if (score >= threshold) {
              celebrationCandidates.push({
                courseId: row.courseId,
                score,
                gradeValue: value,
                type: 'gradeItem',
              })
            }
          }
        }

        const finalValue = parseOptionalNumber(shkoloForm.termGradeSource === 'term1' ? row.term1Final : row.term2Final)
        if (finalValue != null) {
          items.push({
            courseId: row.courseId,
            categoryId: termGradeId,
            gradeValue: finalValue,
            weight: 1,
            note: `Shkolo term grade (${shkoloForm.termGradeSource === 'term1' ? 'Term 1' : 'Term 2'})`,
            isFinal: true,
            finalType: shkoloForm.termGradeSource === 'term1' ? 'TERM1' : 'TERM2',
            importMetadata,
          })
          const score = gradeToNormalizedScore(shkoloForm.scale, finalValue)
          if (score >= threshold && isExcellentTermFinal(shkoloForm.scale, finalValue)) {
            celebrationCandidates.push({
              courseId: row.courseId,
              score,
              gradeValue: finalValue,
              type: 'termFinal',
            })
          }
        }
      }

      if (!items.length) return { count: 0, beforeAverageMap, celebrationCandidates }
      const result = await bulkImportGrades({
        termId: shkoloForm.targetTermId,
        scale: shkoloForm.scale,
        gradedOn: shkoloForm.gradedOn,
        items,
      })
      return { count: result.count, beforeAverageMap, celebrationCandidates }
    },
    onSuccess: async (payload) => {
      const count = typeof payload === 'number' ? payload : payload.count
      await queryClient.invalidateQueries({ queryKey: ['grades', selectedTermId] })
      await queryClient.invalidateQueries({ queryKey: ['grades-summary', selectedTermId] })
      setImportOpen(false)
      setImportMode('text')
      setShkoloPreviewRows([])
      setShkoloMeta(null)
      closeShkoloCreateCourseDialog()
      setShkoloEditingSubjectRowKey(null)
      setShkoloEditingSubjectValue('')
      setShkoloMoveGradeDialog(null)
      setShkoloMoveGradeTargetRowKey('')
      setShkoloSaveConfirmOpen(false)
      setShkoloRemovedRowsCount(0)
      setShkoloRemoveRowKey(null)
      setShkoloAlwaysIgnoreSubject(false)
      setShkoloForm((current) => ({ ...current, file: null }))
      toast({
        variant: 'success',
        title: 'Shkolo PDF import complete',
        description: `Imported ${count} grade item${count === 1 ? '' : 's'}.`,
      })

      if (typeof payload !== 'number' && payload.celebrationCandidates.length > 0) {
        const refreshed = await getGrades({ termId: shkoloForm.targetTermId })
        const afterAverageMap = getCourseAverageScoreMap(refreshed)
        const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
        const crossingCandidates = Array.from(
          new Set(payload.celebrationCandidates.map((item) => item.courseId)),
        )
          .map((courseId) => {
            const before = payload.beforeAverageMap.get(courseId)
            const after = afterAverageMap.get(courseId)
            if (before == null || after == null) return null
            if (before < threshold && after >= threshold) {
              return { type: 'courseAverage' as const, courseId, score: after, gradeValue: null, delta: after - before }
            }
            return null
          })
          .filter((item): item is { type: 'courseAverage'; courseId: string; score: number; gradeValue: null; delta: number } => item != null)

        const best = [
          ...payload.celebrationCandidates.map((item) => ({ ...item, delta: 0 })),
          ...crossingCandidates,
        ].sort((a, b) => (b.delta !== a.delta ? b.delta - a.delta : b.score - a.score))[0]
        if (best) {
          await triggerCelebration({
            type: best.type,
            courseId: best.courseId,
            score: best.score,
            gradeValue: best.gradeValue,
            termId: shkoloForm.targetTermId,
          })
        }
      }
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
    onMutate: async (payload) => {
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
      const items = payload.items
        .map((item) => {
          const score = gradeToNormalizedScore(payload.scale, item.gradeValue)
          if (score < threshold) return null
          return {
            courseId: item.courseId,
            score,
            gradeValue: item.gradeValue,
            type: 'gradeItem' as const,
          }
        })
        .filter((item): item is { courseId: string; score: number; gradeValue: number; type: 'gradeItem' } => item != null)
      lastBulkImportContextRef.current = {
        beforeAverageMap: new Map(currentCourseAverageScoreMap),
        items,
      }
    },
    onSuccess: async (result, variables) => {
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

      const context = lastBulkImportContextRef.current
      lastBulkImportContextRef.current = null
      if (!context || !context.items.length) return
      const refreshed = await getGrades({ termId: variables.termId })
      const afterAverageMap = getCourseAverageScoreMap(refreshed)
      const threshold = meQuery.data?.settings?.celebrationScoreThreshold ?? 90
      const crossingCandidates = Array.from(
        new Set(context.items.map((item) => item.courseId)),
      )
        .map((courseId) => {
          const before = context.beforeAverageMap.get(courseId)
          const after = afterAverageMap.get(courseId)
          if (before == null || after == null) return null
          if (before < threshold && after >= threshold) {
            return { type: 'courseAverage' as const, courseId, score: after, gradeValue: null, delta: after - before }
          }
          return null
        })
        .filter((item): item is { type: 'courseAverage'; courseId: string; score: number; gradeValue: null; delta: number } => item != null)

      const best = [
        ...context.items.map((item) => ({ ...item, delta: 0 })),
        ...crossingCandidates,
      ].sort((a, b) => (b.delta !== a.delta ? b.delta - a.delta : b.score - a.score))[0]
      if (!best) return
      await triggerCelebration({
        type: best.type,
        courseId: best.courseId,
        score: best.score,
        gradeValue: best.gradeValue,
        termId: variables.termId,
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
  const academicRisk = academicRiskQuery.data ?? []
  const currentCourseAverageScoreMap = useMemo(() => getCourseAverageScoreMap(grades), [grades])
  const lastBulkImportContextRef = useRef<{
    beforeAverageMap: Map<string, number>
    items: Array<{
      courseId: string
      score: number
      gradeValue?: number | null
      type: 'gradeItem' | 'termFinal'
    }>
  } | null>(null)
  const riskByCourseId = useMemo(() => new Map(academicRisk.map((item) => [item.courseId, item])), [academicRisk])
  const riskSettings = meQuery.data?.settings
  const needsAttentionItems = useMemo(() => academicRisk, [academicRisk])
  const needsAttentionCaption = useMemo(() => {
    const lookback = riskSettings?.riskLookback ?? 'currentTerm'
    const mode = riskSettings?.riskThresholdMode ?? 'score'
    const threshold =
      mode === 'score'
        ? `${(riskSettings?.riskScoreThreshold ?? 70).toFixed(1)} score`
        : `${formatAverageValue(
            summaryDisplayScale,
            riskSettings?.riskGradeThresholdByScale?.[summaryDisplayScale] ??
              (summaryDisplayScale === 'bulgarian' ? 4.5 : summaryDisplayScale === 'german' ? 3.5 : 70),
          )}`
    const preferFinal = riskSettings?.riskUseTermFinalIfAvailable ?? true
    return `Flagged when below threshold (${threshold}) in ${lookback}. Min ${riskSettings?.riskMinDataPoints ?? 2} grade items. Prefer term final: ${preferFinal ? 'on' : 'off'}.`
  }, [riskSettings, summaryDisplayScale])

  useEffect(() => {
    if (!terms.length || !selectedTermId) return
    const selected = terms.find((term) => term.id === selectedTermId) ?? terms[0]
    if (!selected) return

    setShkoloForm((current) => ({
      ...current,
      targetTermId: current.targetTermId || selected.id,
    }))
  }, [selectedTermId, terms])
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
  const selectedCourseForRename = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
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
    if (!selectedCourseId || editingCourseNameId == null) return
    if (editingCourseNameId !== selectedCourseId) {
      setEditingCourseNameId(null)
      setEditingCourseNameValue('')
    }
  }, [editingCourseNameId, selectedCourseId])

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
  const shkoloReadyRowsCount = shkoloPreviewRows.filter((row) => {
    if (!row.courseId) return false
    const selectedTermGrade = parseOptionalNumber(shkoloForm.termGradeSource === 'term1' ? row.term1Final : row.term2Final)
    if (selectedTermGrade != null) return true
    if (shkoloForm.includeCurrentGrades) {
      if (parseGradeListText(row.term1Current).length > 0) return true
      if (parseGradeListText(row.term2Current).length > 0) return true
    }
    return false
  }).length
  const canImportShkolo =
    shkoloPreviewRows.length > 0 && shkoloReadyRowsCount > 0
  const shkoloLowConfidenceRows = shkoloPreviewRows.filter(
    (row) => row.matchScore < SHKOLO_UNMATCHED_THRESHOLD,
  )
  const hasShkoloLowConfidenceRows = shkoloLowConfidenceRows.length > 0
  const shkoloRemoveCandidate = shkoloRemoveRowKey
    ? shkoloPreviewRows.find((row) => row.key === shkoloRemoveRowKey) ?? null
    : null
  const shkoloCreateCourseCandidate = shkoloCreateCourseRowKey
    ? shkoloPreviewRows.find((row) => row.key === shkoloCreateCourseRowKey) ?? null
    : null

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
                <CardDescription>One row per subject with inline grade chips and quick actions.</CardDescription>
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
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      setDeleteTermGradesConfirmOpen(true)
                      setDeleteTermGradesConfirmText('')
                    }}
                  >
                    Delete all grades for term
                  </Button>
                ) : null}
                {selectedTermId ? (
                  <Button variant="ghost" size="icon" onClick={() => deleteTermMutation.mutate(selectedTermId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-w-0">
            <SubjectGradeTable
              grades={grades}
              displayScale={summaryDisplayScale}
              includeTermGrade={includeTermGradeInAverage}
              riskByCourseId={riskByCourseId}
              onSelectCourse={(courseId) => setSelectedCourseId(courseId)}
              onOpenAddGradeForCourse={(courseId) => {
                setSelectedCourseId(courseId)
                setGradeForm((current) => ({
                  ...current,
                  courseId,
                  categoryId: '',
                  gradedOn: new Date().toISOString().slice(0, 10),
                }))
                setAddGradeOpen(true)
              }}
              onUpdateGrade={(gradeId, payload) => {
                updateGradeMutation.mutate({
                  id: gradeId,
                  payload,
                })
              }}
              onDeleteGrade={async (gradeId) => {
                await deleteGradeMutation.mutateAsync(gradeId)
              }}
              onDeleteCourseGrades={(gradeIds) => deleteManyGradesMutation.mutate(gradeIds)}
              pending={updateGradeMutation.isPending || deleteManyGradesMutation.isPending || deleteGradeMutation.isPending}
              loading={gradesQuery.isPending}
            />
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
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display scale</span>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                    value={summaryDisplayScale}
                    onChange={(event) => setSummaryDisplayScale(event.target.value as GradeScale)}
                  >
                    <option value="bulgarian">Bulgarian (2-6)</option>
                    <option value="percentage">Normalized (0-100)</option>
                    <option value="german">German (1-6)</option>
                  </select>
                </label>
                <label className="flex items-end gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={includeTermGradeInAverage}
                    onChange={(event) => setIncludeTermGradeInAverage(event.target.checked)}
                  />
                  Include term grade as 1 item
                </label>
              </div>
              <p>
                Overall average ({summaryDisplayScale === 'bulgarian' ? 'Bulgarian 2-6' : 'selected scale'}):{' '}
                {summary?.overallAverage != null ? (
                  <GradeChip scale={summaryDisplayScale} value={summary.overallAverage} />
                ) : (
                  <span className="font-semibold">-</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Normalized score (0-100):{' '}
                <span className="font-semibold text-foreground">{formatScore(summary?.overallAverageNormalized)}</span>
              </p>
              <p>
                Previous term:{' '}
                <span className="font-semibold">{formatAverageValue(summaryDisplayScale, summary?.previousTermAverage)}</span>
                {summary?.deltaFromPrevious != null ? (
                  <span className={cn('ml-2 text-xs', summary.deltaFromPrevious >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                    {summary.deltaFromPrevious >= 0 ? '+' : ''}
                    {summaryDisplayScale === 'percentage' ? summary.deltaFromPrevious.toFixed(1) : summary.deltaFromPrevious.toFixed(2)}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">{summary?.method ?? 'Averaging method unavailable.'}</p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best courses</p>
                <div className="mt-1 space-y-1">
                  {(summary?.bestCourses ?? []).map((course) => (
                    <p key={course.courseId} className="text-sm">
                      {course.courseName}{' '}
                      <span className="text-muted-foreground">
                        (
                        <GradeChip className="mx-1 inline-flex align-middle" scale={summaryDisplayScale} value={course.averageValue} />
                        | {formatScore(course.averageNormalizedScore)} score)
                      </span>
                    </p>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worst courses</p>
                <div className="mt-1 space-y-1">
                  {(summary?.worstCourses ?? []).map((course) => (
                    <p key={course.courseId} className="text-sm">
                      {course.courseName}{' '}
                      <span className="text-muted-foreground">
                        (
                        <GradeChip className="mx-1 inline-flex align-middle" scale={summaryDisplayScale} value={course.averageValue} />
                        | {formatScore(course.averageNormalizedScore)} score)
                      </span>
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
              {selectedCourseForRename ? (
                <div className="rounded-md border border-border/70 bg-background/70 p-2.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Selected course</div>
                  {editingCourseNameId === selectedCourseForRename.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editingCourseNameValue}
                        onChange={(event) => setEditingCourseNameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            const nextName = editingCourseNameValue.trim()
                            if (nextName) {
                              updateCourseMutation.mutate({ id: selectedCourseForRename.id, name: nextName })
                            }
                          }
                          if (event.key === 'Escape') {
                            setEditingCourseNameId(null)
                            setEditingCourseNameValue('')
                          }
                        }}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        title="Save name"
                        onClick={() => {
                          const nextName = editingCourseNameValue.trim()
                          if (!nextName) return
                          updateCourseMutation.mutate({ id: selectedCourseForRename.id, name: nextName })
                        }}
                        disabled={!editingCourseNameValue.trim() || updateCourseMutation.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Cancel rename"
                        onClick={() => {
                          setEditingCourseNameId(null)
                          setEditingCourseNameValue('')
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{selectedCourseForRename.name}</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit name"
                        onClick={() => {
                          setEditingCourseNameId(selectedCourseForRename.id)
                          setEditingCourseNameValue(selectedCourseForRename.name)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
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
                Course average:{' '}
                {selectedCourseOverallByCategory == null ? (
                  <span className="font-semibold">-</span>
                ) : (
                  <GradeChip scale="percentage" value={selectedCourseOverallByCategory} />
                )}
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
                      <GradeChip className="inline-flex align-middle" scale={grade.scale} value={grade.gradeValue} />
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

          {needsAttentionItems.length > 0 ? (
            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="text-base">Needs Attention</CardTitle>
                <CardDescription>{needsAttentionCaption}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {needsAttentionItems.slice(0, 5).map((item) => (
                  <div key={item.courseId} className="rounded-md border border-border/70 bg-background/70 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.courseName}</p>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={item.riskLevel === 'high' ? 'default' : 'secondary'}
                          className={item.riskLevel === 'high' ? 'bg-destructive/15 text-destructive' : undefined}
                        >
                          Needs attention
                        </Badge>
                        <Badge variant="outline">Risk {item.riskScore}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Avg {formatAverageValue(summaryDisplayScale, item.currentAverage)} ({formatScore(item.currentAverageNormalized)} normalized)
                    </p>
                    {item.reasons[0] ? (
                      <p className="mt-1 text-xs font-medium text-foreground">{item.reasons[0]}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.recommendedMinutes > 0
                        ? `Recommend ${item.recommendedMinutes} min over next 7 days.`
                        : 'No extra study needed right now.'}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {item.reasons.slice(0, 2).map((reason) => (
                        <p key={reason} className="text-xs text-muted-foreground">• {reason}</p>
                      ))}
                    </div>
                    {item.recommendedMinutes > 0 ? (
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
                    ) : null}
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
                ))}
              </CardContent>
            </Card>
          ) : null}
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

      <Dialog
        open={deleteTermGradesConfirmOpen}
        onOpenChange={(open) => {
          setDeleteTermGradesConfirmOpen(open)
          if (!open) setDeleteTermGradesConfirmText('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all grades for this term</DialogTitle>
            <DialogDescription>
              This permanently deletes all grade items in the selected term. Courses are not deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
            </p>
            <Input
              value={deleteTermGradesConfirmText}
              onChange={(event) => setDeleteTermGradesConfirmText(event.target.value)}
              placeholder="DELETE"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTermGradesConfirmOpen(false)
                setDeleteTermGradesConfirmText('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (!selectedTermId) return
                deleteTermGradesMutation.mutate(selectedTermId)
              }}
              disabled={deleteTermGradesConfirmText !== 'DELETE' || !selectedTermId || deleteTermGradesMutation.isPending}
            >
              Delete all grades
            </Button>
          </DialogFooter>
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
            <DialogTitle>Import grades</DialogTitle>
            <DialogDescription>Choose a source and review before saving.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={importMode === 'text' ? 'default' : 'outline'}
              onClick={() => setImportMode('text')}
            >
              Paste text
            </Button>
            <Button
              type="button"
              variant={importMode === 'shkolo-pdf' ? 'default' : 'outline'}
              onClick={() => setImportMode('shkolo-pdf')}
            >
              Import Shkolo PDF
            </Button>
          </div>
          <div className="space-y-3">
            {importMode === 'text' ? (
              <>
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
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">Scale</span>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={shkoloForm.scale}
                      onChange={(event) => setShkoloForm((current) => ({ ...current, scale: event.target.value as GradeScale }))}
                    >
                      <option value="bulgarian">Bulgarian (2-6)</option>
                      <option value="percentage">Percentage (0-100)</option>
                      <option value="german">German (1.0-6.0)</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">Date</span>
                    <Input
                      type="date"
                      value={shkoloForm.gradedOn}
                      onChange={(event) => setShkoloForm((current) => ({ ...current, gradedOn: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">Target term</span>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={shkoloForm.targetTermId}
                      onChange={(event) => setShkoloForm((current) => ({ ...current, targetTermId: event.target.value }))}
                    >
                      <option value="">Select term</option>
                      {terms.map((term) => (
                        <option key={term.id} value={term.id}>
                          {term.schoolYear} • {term.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-sm font-medium">Term grade source</span>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={shkoloForm.termGradeSource}
                      onChange={(event) =>
                        setShkoloForm((current) => ({
                          ...current,
                          termGradeSource: event.target.value as 'term1' | 'term2',
                        }))
                      }
                    >
                      <option value="term1">Term 1 (Първи срок)</option>
                      <option value="term2">Term 2 (Втори срок)</option>
                    </select>
                  </label>
                </div>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Upload Shkolo PDF</span>
                  <Input
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => {
                      setShkoloMeta(null)
                      setShkoloPreviewRows([])
                      setShkoloRemovedRowsCount(0)
                      closeShkoloCreateCourseDialog()
                      setShkoloEditingSubjectRowKey(null)
                      setShkoloEditingSubjectValue('')
                      setShkoloMoveGradeDialog(null)
                      setShkoloMoveGradeTargetRowKey('')
                      setShkoloSaveConfirmOpen(false)
                      setShkoloRemoveRowKey(null)
                      setShkoloAlwaysIgnoreSubject(false)
                      setShkoloForm((current) => ({
                        ...current,
                        file: event.target.files?.[0] ?? null,
                      }))
                    }}
                  />
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={shkoloForm.includeCurrentGrades}
                    onChange={(event) =>
                      setShkoloForm((current) => ({ ...current, includeCurrentGrades: event.target.checked }))
                    }
                  />
                  Import current grades as individual items
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showShkoloDebug}
                    onChange={(event) => setShowShkoloDebug(event.target.checked)}
                  />
                  Show debug
                </label>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => shkoloExtractMutation.mutate()}
                  disabled={!shkoloForm.file || shkoloExtractMutation.isPending}
                >
                  Parse Shkolo PDF
                </Button>

                {shkoloMeta ? (
                  <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                    <p>
                      File: <span className="font-medium text-foreground">{shkoloMeta.fileName}</span>
                    </p>
                    <p>
                      Parsed rows: <span className="font-medium text-foreground">{shkoloMeta.parsedRows}</span>
                      {' · '}
                      Removed rows: <span className="font-medium text-foreground">{shkoloRemovedRowsCount}</span>
                      {' · '}
                      Skipped rows: <span className="font-medium text-foreground">{shkoloMeta.skippedLines}</span>
                      {' · '}
                      Ready to import: <span className="font-medium text-foreground">{shkoloReadyRowsCount}</span>
                      {' · '}
                      Subjects found: <span className="font-medium text-foreground">{shkoloMeta.subjectsFound}</span>
                    </p>
                    <p>
                      Current grades: <span className="font-medium text-foreground">{shkoloMeta.currentGradesCount}</span>
                      {' · '}
                      Term grades: <span className="font-medium text-foreground">{shkoloMeta.termGradesFoundCount}</span>
                    </p>
                    {shkoloMeta.parseWarnings.length > 0 ? (
                      <p>
                        Parse warnings: <span className="font-medium text-foreground">{shkoloMeta.parseWarnings.length}</span>
                      </p>
                    ) : null}
                    {shkoloMeta.detectedYear ? (
                      <p>
                        Detected year: <span className="font-medium text-foreground">{shkoloMeta.detectedYear}</span>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {shkoloMeta && shkoloMeta.parseWarnings.length > 0 ? (
                  <details className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <summary className="cursor-pointer font-medium">
                      Parse warnings ({shkoloMeta.parseWarnings.length})
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {shkoloMeta.parseWarnings.map((warning, index) => (
                        <li key={`shkolo-warning-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {shkoloMeta && shkoloMeta.parsedRows === 0 ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    No subjects detected. Try a different PDF export or enable debug.
                  </div>
                ) : null}

                {showShkoloDebug ? (
                  shkoloMeta?.debug ? (
                    <div className="space-y-2 rounded-md border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <p>
                          Extracted text total: <span className="font-medium text-foreground">{shkoloMeta.debug.totalExtractedLength}</span>
                          {' · '}
                          OCR fallback: <span className="font-medium text-foreground">{shkoloMeta.debug.usedOcrFallback ? 'yes' : 'no'}</span>
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={downloadShkoloDebugJson}>
                          Download debug JSON
                        </Button>
                      </div>
                      {shkoloMeta.debug.extractedPageTextLengths.map((pageInfo, index) => (
                        <div key={`debug-page-${pageInfo.page}-${index}`} className="rounded border border-border/60 p-2">
                          <p>
                            Page {pageInfo.page}: length {pageInfo.length}
                          </p>
                          {shkoloMeta.debug?.rawSamples[index] ? (
                            <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
                              {shkoloMeta.debug?.rawSamples[index]?.slice(0, 500)}
                            </pre>
                          ) : null}
                          {(() => {
                            const pageItems = shkoloMeta.debug?.pageItems?.[String(pageInfo.page)] ?? []
                            const previewItems = pageItems.slice(0, 200)
                            if (!previewItems.length) return null
                            return (
                              <div className="mt-2">
                                <p className="mb-1 text-[11px] font-medium text-foreground">
                                  Positional items ({previewItems.length} / {pageItems.length})
                                </p>
                                <div className="max-h-48 overflow-auto rounded border border-border/50">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>str</TableHead>
                                        <TableHead>x</TableHead>
                                        <TableHead>y</TableHead>
                                        <TableHead>width</TableHead>
                                        <TableHead>height</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {previewItems.map((item, itemIndex) => (
                                        <TableRow key={`page-${pageInfo.page}-item-${itemIndex}`}>
                                          <TableCell className="max-w-[240px] truncate">{item.str}</TableCell>
                                          <TableCell>{item.x.toFixed(2)}</TableCell>
                                          <TableCell>{item.y.toFixed(2)}</TableCell>
                                          <TableCell>{item.width.toFixed(2)}</TableCell>
                                          <TableCell>{item.height.toFixed(2)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
                      Debug data is available only when you parse with &quot;Show debug&quot; enabled.
                    </div>
                  )
                ) : null}

                {shkoloPreviewRows.length > 0 ? (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead>Matched course</TableHead>
                          <TableHead>T1 current</TableHead>
                          <TableHead>T1 final</TableHead>
                          <TableHead>T2 current</TableHead>
                          <TableHead>T2 final</TableHead>
                          <TableHead>Year final</TableHead>
                          <TableHead>Match</TableHead>
                          <TableHead>Warnings</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shkoloPreviewRows.map((row) => (
                          <TableRow
                            key={row.key}
                            className={row.matchScore < SHKOLO_UNMATCHED_THRESHOLD ? 'border-l-2 border-l-amber-500/70 bg-amber-500/5' : undefined}
                          >
                            <TableCell>
                              <div className="space-y-1">
                                {shkoloEditingSubjectRowKey === row.key ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={shkoloEditingSubjectValue}
                                      onChange={(event) => setShkoloEditingSubjectValue(event.target.value)}
                                    />
                                    <Button type="button" variant="outline" size="sm" onClick={() => saveShkoloSubjectNameEdit(row.key)}>
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setShkoloEditingSubjectRowKey(null)
                                        setShkoloEditingSubjectValue('')
                                      }}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium">{row.subjectName}</p>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setShkoloEditingSubjectRowKey(row.key)
                                        setShkoloEditingSubjectValue(row.subjectName)
                                      }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                      Edit name
                                    </Button>
                                  </div>
                                )}
                                <Button type="button" variant="outline" size="sm" onClick={() => rematchShkoloRow(row.key, row.subjectName)}>
                                  Re-match
                                </Button>
                                {row.matchScore < SHKOLO_UNMATCHED_THRESHOLD ? (
                                  <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                    Needs review
                                  </Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-2">
                                {courses.length > 0 ? (
                                  <select
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                    value={row.courseId}
                                    onChange={(event) => {
                                      const value = event.target.value
                                      if (value === '__create_new__') {
                                        openShkoloCreateCourseDialog(row.key, row.subjectName)
                                        setShkoloPreviewRows((current) =>
                                          current.map((item) =>
                                            item.key === row.key
                                              ? { ...item, courseId: '', matchedCourseName: '', matchDebug: item.matchDebug }
                                              : item,
                                          ),
                                        )
                                        return
                                      }
                                      const selected = courses.find((course) => course.id === value)
                                      setShkoloPreviewRows((current) =>
                                        current.map((item) =>
                                          item.key === row.key
                                            ? {
                                                ...item,
                                                courseId: value,
                                                matchedCourseName: selected?.name ?? '',
                                                matchScore: 1,
                                                matchDebug: {
                                                  normalizedExtracted: row.subjectName.normalize('NFKD').toLowerCase(),
                                                  normalizedCandidate: (selected?.name ?? '').normalize('NFKD').toLowerCase(),
                                                  levenshteinDistance: 0,
                                                  tokenScore: 1,
                                                  charScore: 1,
                                                  overlapBonus: 0,
                                                  threshold: SHKOLO_UNMATCHED_THRESHOLD,
                                                  formula: 'manually selected course assigned',
                                                },
                                              }
                                            : item,
                                        ),
                                      )
                                    }}
                                  >
                                    <option value="__create_new__">+ Create new course…</option>
                                    <option value="">Match course...</option>
                                    {courses.map((course) => (
                                      <option key={course.id} value={course.id}>
                                        {course.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="rounded-md border border-border/70 bg-background/70 p-2 text-xs text-muted-foreground">
                                    <p>No courses found.</p>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="mt-2"
                                      onClick={() => openShkoloCreateCourseDialog(row.key, row.subjectName)}
                                    >
                                      Create first course
                                    </Button>
                                  </div>
                                )}
                                {!row.courseId ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openShkoloCreateCourseDialog(row.key, row.subjectName)}
                                  >
                                    + Create course
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-1">
                                  {parseGradeListText(row.term1Current).map((value, chipIndex) => (
                                    <div key={`${row.key}-t1-current-${chipIndex}`} className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => startShkoloMoveGrade(row.key, 'term1Current', chipIndex, value)}
                                        className="rounded"
                                        title="Move to subject"
                                      >
                                        <GradeChip
                                          scale={shkoloForm.scale}
                                          value={value}
                                          className="text-[11px] cursor-pointer"
                                          title="Click to move to another subject"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground"
                                        title="Remove this grade"
                                        onClick={() =>
                                          updateShkoloCurrentGrades(row.key, 'term1Current', (values) =>
                                            values.filter((_, index) => index !== chipIndex),
                                          )
                                        }
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <Input
                                  value={row.term1Current}
                                  onChange={(event) =>
                                    setShkoloPreviewRows((current) =>
                                      current.map((item) => (item.key === row.key ? { ...item, term1Current: event.target.value } : item)),
                                    )
                                  }
                                  placeholder="e.g. 6, 5, 5.50"
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={row.term1Final}
                                onChange={(event) =>
                                  setShkoloPreviewRows((current) =>
                                    current.map((item) => (item.key === row.key ? { ...item, term1Final: event.target.value } : item)),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-1">
                                  {parseGradeListText(row.term2Current).map((value, chipIndex) => (
                                    <div key={`${row.key}-t2-current-${chipIndex}`} className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => startShkoloMoveGrade(row.key, 'term2Current', chipIndex, value)}
                                        className="rounded"
                                        title="Move to subject"
                                      >
                                        <GradeChip
                                          scale={shkoloForm.scale}
                                          value={value}
                                          className="text-[11px] cursor-pointer"
                                          title="Click to move to another subject"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/60 text-muted-foreground hover:text-foreground"
                                        title="Remove this grade"
                                        onClick={() =>
                                          updateShkoloCurrentGrades(row.key, 'term2Current', (values) =>
                                            values.filter((_, index) => index !== chipIndex),
                                          )
                                        }
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <Input
                                  value={row.term2Current}
                                  onChange={(event) =>
                                    setShkoloPreviewRows((current) =>
                                      current.map((item) => (item.key === row.key ? { ...item, term2Current: event.target.value } : item)),
                                    )
                                  }
                                  placeholder="e.g. 6, 5, 5.50"
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={row.term2Final}
                                onChange={(event) =>
                                  setShkoloPreviewRows((current) =>
                                    current.map((item) => (item.key === row.key ? { ...item, term2Final: event.target.value } : item)),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={row.yearFinal}
                                onChange={(event) =>
                                  setShkoloPreviewRows((current) =>
                                    current.map((item) => (item.key === row.key ? { ...item, yearFinal: event.target.value } : item)),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="space-y-1 text-xs text-muted-foreground">
                              <p title={buildMatchTooltip(row.matchDebug)}>{Math.round(row.matchScore * 100)}%</p>
                              {row.matchScore < SHKOLO_UNMATCHED_THRESHOLD ? (
                                <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                  Needs review
                                </Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {row.parseWarnings.length > 0 || row.rawRowText ? (
                                <details className="max-w-[260px] text-xs">
                                  <summary className="cursor-pointer text-amber-600 dark:text-amber-300">
                                    {row.parseWarnings.length > 0 ? `${row.parseWarnings.length} warning(s)` : 'Show raw row'}
                                  </summary>
                                  {row.parseWarnings.length > 0 ? (
                                    <ul className="mt-1 list-disc space-y-1 pl-4">
                                      {row.parseWarnings.map((warning, warningIndex) => (
                                        <li key={`${row.key}-warning-${warningIndex}`}>{warning}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                  {row.rawRowText ? (
                                    <pre className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded border border-border/60 p-2 text-[11px] text-muted-foreground">
                                      {row.rawRowText}
                                    </pre>
                                  ) : null}
                                </details>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => removeShkoloRow(row.key)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete subject
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <DialogFooter>
            {importMode === 'text' ? (
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
            ) : (
              <Button
                onClick={() => {
                  if (hasShkoloLowConfidenceRows) {
                    setShkoloSaveConfirmOpen(true)
                    return
                  }
                  shkoloImportSaveMutation.mutate()
                }}
                disabled={
                  !shkoloMeta ||
                  shkoloMeta.parsedRows === 0 ||
                  !canImportShkolo ||
                  !shkoloForm.targetTermId ||
                  shkoloImportSaveMutation.isPending
                }
              >
                Save parsed grades
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(shkoloCreateCourseCandidate)}
        onOpenChange={(open) => {
          if (!open) closeShkoloCreateCourseDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create course</DialogTitle>
            <DialogDescription>
              Create a new course and assign it to this imported subject.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Course name</label>
              <Input
                value={shkoloCreateCourseName}
                onChange={(event) => setShkoloCreateCourseName(event.target.value)}
                placeholder="Course name"
              />
            </div>
            {shkoloCreateCourseCandidate ? (
              <p className="text-xs text-muted-foreground">
                Extracted subject: <span className="font-medium text-foreground">{shkoloCreateCourseCandidate.subjectName}</span>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => closeShkoloCreateCourseDialog()}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!shkoloCreateCourseCandidate) return
                createShkoloCourseMutation.mutate({
                  rowKey: shkoloCreateCourseCandidate.key,
                  name: shkoloCreateCourseName,
                })
              }}
              disabled={!shkoloCreateCourseName.trim() || createShkoloCourseMutation.isPending || !shkoloCreateCourseCandidate}
            >
              Create &amp; assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shkoloSaveConfirmOpen} onOpenChange={setShkoloSaveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm unmatched subjects</DialogTitle>
            <DialogDescription>
              {shkoloLowConfidenceRows.length} subject match{shkoloLowConfidenceRows.length === 1 ? '' : 'es'} look weak (below {Math.round(SHKOLO_UNMATCHED_THRESHOLD * 100)}%).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-border/70 p-2 text-sm">
            {shkoloLowConfidenceRows.map((row) => (
              <div key={`unmatched-${row.key}`} className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate">{row.subjectName}</p>
                <Badge variant="outline" className="shrink-0 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  {Math.round(row.matchScore * 100)}%
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShkoloSaveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShkoloSaveConfirmOpen(false)
                shkoloImportSaveMutation.mutate()
              }}
              disabled={shkoloImportSaveMutation.isPending}
            >
              Confirm and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(shkoloMoveGradeDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setShkoloMoveGradeDialog(null)
            setShkoloMoveGradeTargetRowKey('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move grade to subject</DialogTitle>
            <DialogDescription>
              Choose where to move this grade chip in the current preview.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Grade: <span className="font-medium text-foreground">{shkoloMoveGradeDialog?.gradeValue ?? '-'}</span>
            </p>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={shkoloMoveGradeTargetRowKey}
              onChange={(event) => setShkoloMoveGradeTargetRowKey(event.target.value)}
            >
              <option value="">Select target subject...</option>
              {shkoloPreviewRows
                .filter((row) => row.key !== shkoloMoveGradeDialog?.fromRowKey)
                .map((row) => (
                  <option key={`move-target-${row.key}`} value={row.key}>
                    {row.subjectName}
                  </option>
                ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShkoloMoveGradeDialog(null)
                setShkoloMoveGradeTargetRowKey('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmShkoloMoveGrade}
              disabled={!shkoloMoveGradeTargetRowKey}
            >
              Move grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(shkoloRemoveCandidate)}
        onOpenChange={(open) => {
          if (!open) {
            setShkoloRemoveRowKey(null)
            setShkoloAlwaysIgnoreSubject(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove subject from import</DialogTitle>
            <DialogDescription>
              Remove this subject from import?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/70 bg-background/70 p-3 text-sm">
              {shkoloRemoveCandidate?.subjectName ?? 'Selected subject'}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shkoloAlwaysIgnoreSubject}
                onChange={(event) => setShkoloAlwaysIgnoreSubject(event.target.checked)}
              />
              Always ignore this subject in future imports
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShkoloRemoveRowKey(null)
                setShkoloAlwaysIgnoreSubject(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => confirmRemoveShkoloRow()}
              disabled={saveIgnoredShkoloSubjectsMutation.isPending}
            >
              Remove
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
