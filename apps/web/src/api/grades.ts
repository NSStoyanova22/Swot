import { apiRequest } from '@/api/client'
import type {
  AcademicRiskDto,
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

export async function getGradesSummary(termId: string, signal?: AbortSignal) {
  return apiRequest<GradesSummaryDto>('/analytics/grades-summary', {
    query: { termId },
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

export async function getStudyRecommendations(query: { termId: string; from?: string; to?: string }, signal?: AbortSignal) {
  return apiRequest<StudyRecommendationDto[]>('/recommendations/study-plan', {
    query,
    signal,
  })
}

export async function getAcademicRisk(query: { termId?: string; from?: string; to?: string } = {}, signal?: AbortSignal) {
  return apiRequest<AcademicRiskDto[]>('/analytics/academic-risk', {
    query,
    signal,
  })
}
