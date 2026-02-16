import { apiRequest } from '@/api/client'
import type { StreakOverviewDto } from '@/api/dtos'

export async function getStreakOverview(signal?: AbortSignal) {
  return apiRequest<StreakOverviewDto>('/streak', { signal })
}
