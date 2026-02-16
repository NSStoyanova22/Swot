import { apiRequest } from '@/api/client'
import type { HealthDto } from '@/api/dtos'

export async function getHealth(signal?: AbortSignal) {
  return apiRequest<HealthDto>('/health', { signal })
}
