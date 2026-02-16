import { apiRequest } from '@/api/client'
import type {
  CreateDistractionDto,
  DistractionAnalyticsDto,
  DistractionDto,
} from '@/api/dtos'

export async function getSessionDistractions(sessionId: string, signal?: AbortSignal) {
  return apiRequest<DistractionDto[]>(`/sessions/${sessionId}/distractions`, { signal })
}

export async function createSessionDistraction(sessionId: string, body: CreateDistractionDto) {
  return apiRequest<DistractionDto>(`/sessions/${sessionId}/distractions`, {
    method: 'POST',
    body,
  })
}

export async function getDistractionAnalytics(days = 30, signal?: AbortSignal) {
  return apiRequest<DistractionAnalyticsDto>('/distractions/analytics', {
    query: { days },
    signal,
  })
}
