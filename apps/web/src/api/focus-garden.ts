import { apiRequest } from '@/api/client'
import type { FocusGardenOverviewDto } from '@/api/dtos'

type FocusGardenOverviewQuery = {
  days?: number
  timelineLimit?: number
}

export async function getFocusGardenOverview(
  query: FocusGardenOverviewQuery = {},
  signal?: AbortSignal,
) {
  return apiRequest<FocusGardenOverviewDto>('/focus-garden/overview', {
    query,
    signal,
  })
}
