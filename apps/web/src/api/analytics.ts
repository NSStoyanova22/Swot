import { apiRequest } from '@/api/client'
import type { AnalyticsInsightsDto, AnalyticsPredictionDto } from '@/api/dtos'

export async function getAnalyticsInsights(signal?: AbortSignal) {
  return apiRequest<AnalyticsInsightsDto>('/analytics/insights', { signal })
}

export async function getAnalyticsPrediction(signal?: AbortSignal) {
  return apiRequest<AnalyticsPredictionDto>('/analytics/prediction', { signal })
}
