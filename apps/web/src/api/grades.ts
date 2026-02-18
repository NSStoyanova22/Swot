import { apiRequest } from '@/api/client'
import type {
  AcademicRiskDto,
  CelebrationStateDto,
  BulkGradeImportDto,
  BulkGradeImportResultDto,
  CreateGradeCategoryDto,
  CourseGradeTargetDto,
  GradeCategoryDto,
  CreateGradeItemDto,
  CreateTermDto,
  GradeItemDto,
  GradesWhatIfResultDto,
  GradesSummaryDto,
  OcrTextResponseDto,
  ShkoloPdfImportResultDto,
  StudyRecommendationDto,
  TermDto,
  UpdateGradeCategoryDto,
  UpdateGradeItemDto,
  UpdateTermDto,
} from '@/api/dtos'

export async function getTerms(query: { schoolYear?: string } = {}, signal?: AbortSignal) {
  return apiRequest<TermDto[]>('/terms', { query, signal })
}

export async function createTerm(payload: CreateTermDto) {
  return apiRequest<TermDto>('/terms', {
    method: 'POST',
    body: payload,
  })
}

export async function updateTerm(id: string, payload: UpdateTermDto) {
  return apiRequest<TermDto>(`/terms/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteTerm(id: string) {
  return apiRequest<{ ok: boolean }>(`/terms/${id}`, {
    method: 'DELETE',
  })
}

export async function deleteAllGradesForTerm(termId: string) {
  return apiRequest<{ deletedCount: number }>(`/terms/${termId}/grades`, {
    method: 'DELETE',
  })
}

export async function getGrades(query: { termId?: string; courseId?: string } = {}, signal?: AbortSignal) {
  return apiRequest<GradeItemDto[]>('/grades', { query, signal })
}

export async function createGrade(payload: CreateGradeItemDto) {
  return apiRequest<GradeItemDto>('/grades', {
    method: 'POST',
    body: payload,
  })
}

export async function getGradeCategories(query: { courseId?: string } = {}, signal?: AbortSignal) {
  return apiRequest<GradeCategoryDto[]>('/grade-categories', { query, signal })
}

export async function createGradeCategory(payload: CreateGradeCategoryDto) {
  return apiRequest<GradeCategoryDto>('/grade-categories', {
    method: 'POST',
    body: payload,
  })
}

export async function updateGradeCategory(id: string, payload: UpdateGradeCategoryDto) {
  return apiRequest<GradeCategoryDto>(`/grade-categories/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteGradeCategory(id: string) {
  return apiRequest<{ ok: boolean }>(`/grade-categories/${id}`, {
    method: 'DELETE',
  })
}

export async function bulkImportGrades(payload: BulkGradeImportDto) {
  return apiRequest<BulkGradeImportResultDto>('/grades/bulk', {
    method: 'POST',
    body: payload,
  })
}

export async function extractTextFromImage(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  return apiRequest<OcrTextResponseDto>('/ocr', {
    method: 'POST',
    body: formData,
  })
}

export async function importShkoloPdf(file: File, options: { debug?: boolean } = {}) {
  const formData = new FormData()
  formData.append('file', file)

  return apiRequest<ShkoloPdfImportResultDto>('/grades/import-shkolo-pdf', {
    method: 'POST',
    query: options.debug ? { debug: '1' } : undefined,
    body: formData,
  })
}

export async function updateGrade(id: string, payload: UpdateGradeItemDto) {
  return apiRequest<GradeItemDto>(`/grades/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteGrade(id: string) {
  return apiRequest<{ ok: boolean }>(`/grades/${id}`, {
    method: 'DELETE',
  })
}

export async function getGradesWhatIf(payload: {
  termId: string
  courseId: string
  categoryId: string
  scale: 'percentage' | 'german' | 'bulgarian'
  gradeValue: number
  weight?: number
}) {
  return apiRequest<GradesWhatIfResultDto>('/grades/what-if', {
    method: 'POST',
    body: payload,
  })
}

export async function getGradesSummary(
  termId: string,
  options: { displayScale?: 'percentage' | 'german' | 'bulgarian'; includeTermGrade?: boolean } = {},
  signal?: AbortSignal,
) {
  return apiRequest<GradesSummaryDto>('/analytics/grades-summary', {
    query: {
      termId,
      displayScale: options.displayScale,
      includeTermGrade: options.includeTermGrade ? '1' : '0',
    },
    signal,
  })
}

export async function getGradeTargets(signal?: AbortSignal) {
  return apiRequest<CourseGradeTargetDto[]>('/grades/targets', { signal })
}

export async function upsertGradeTarget(courseId: string, payload: { scale: 'percentage' | 'german' | 'bulgarian'; targetValue: number }) {
  return apiRequest<CourseGradeTargetDto>(`/grades/targets/${courseId}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function getStudyRecommendations(
  query: {
    termId: string
    from?: string
    to?: string
    displayScale?: 'percentage' | 'german' | 'bulgarian'
    includeTermGrade?: boolean
  },
  signal?: AbortSignal,
) {
  const requestQuery = {
    ...query,
    includeTermGrade: query.includeTermGrade ? '1' : '0',
  }
  return apiRequest<StudyRecommendationDto[]>('/recommendations/study-plan', {
    query: requestQuery,
    signal,
  })
}

export async function getAcademicRisk(
  query: {
    termId?: string
    from?: string
    to?: string
    displayScale?: 'percentage' | 'german' | 'bulgarian'
    includeTermGrade?: boolean
  } = {},
  signal?: AbortSignal,
) {
  const requestQuery = {
    ...query,
    includeTermGrade: query.includeTermGrade ? '1' : '0',
  }
  return apiRequest<AcademicRiskDto[]>('/analytics/academic-risk', {
    query: requestQuery,
    signal,
  })
}

export async function getCelebrationState(signal?: AbortSignal) {
  return apiRequest<CelebrationStateDto>('/celebrations/state', { signal })
}

export async function recordCelebration(payload: {
  courseId: string
  score?: number | null
  type?: 'gradeItem' | 'termFinal' | 'courseAverage' | 'all' | 'manual'
}) {
  return apiRequest<{ ok: boolean }>('/celebrations/record', {
    method: 'POST',
    body: payload,
  })
}
