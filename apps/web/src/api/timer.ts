import { apiRequest } from '@/api/client'
import type { TimerRecommendationDto } from '@/api/dtos'

export async function getTimerRecommendation(signal?: AbortSignal) {
  return apiRequest<TimerRecommendationDto>('/timer/recommendation', { signal })
}
