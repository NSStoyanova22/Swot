import { apiRequest } from '@/api/client'
import type {
  CreatePlannerBlockDto,
  PlannerAutoAddDto,
  PlannerAutoAddResultDto,
  PlannerBlockDto,
  PlannerOverviewDto,
  UpdatePlannerBlockDto,
} from '@/api/dtos'

type PlannerRangeQuery = {
  from?: string
  to?: string
}

export async function getPlannerBlocks(query: PlannerRangeQuery = {}, signal?: AbortSignal) {
  return apiRequest<PlannerBlockDto[]>('/planner/blocks', {
    query,
    signal,
  })
}

export async function createPlannerBlock(body: CreatePlannerBlockDto) {
  return apiRequest<PlannerBlockDto>('/planner/blocks', {
    method: 'POST',
    body,
  })
}

export async function updatePlannerBlock(id: string, body: UpdatePlannerBlockDto) {
  return apiRequest<PlannerBlockDto>(`/planner/blocks/${id}`, {
    method: 'PUT',
    body,
  })
}

export async function deletePlannerBlock(id: string) {
  return apiRequest<{ ok: true }>(`/planner/blocks/${id}`, {
    method: 'DELETE',
  })
}

export async function getPlannerOverview(query: PlannerRangeQuery = {}, signal?: AbortSignal) {
  return apiRequest<PlannerOverviewDto>('/planner/overview', {
    query,
    signal,
  })
}

export async function autoAddPlannerBlocks(body: PlannerAutoAddDto) {
  return apiRequest<PlannerAutoAddResultDto>('/planner/auto-add', {
    method: 'POST',
    body,
  })
}
