import { apiRequest } from '@/api/client'
import type { ProductivityOverviewDto } from '@/api/dtos'

export async function getProductivityOverview(signal?: AbortSignal) {
  return apiRequest<ProductivityOverviewDto>('/productivity', { signal })
}
