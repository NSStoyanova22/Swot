import { apiRequest } from '@/api/client'
import type { AchievementsResponseDto } from '@/api/dtos'

export async function getAchievements(signal?: AbortSignal) {
  return apiRequest<AchievementsResponseDto>('/achievements', { signal })
}
