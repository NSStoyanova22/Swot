import { apiRequest } from '@/api/client'
import type { ActivityDto, CreateActivityDto, UpdateActivityDto } from '@/api/dtos'

export async function getActivities(signal?: AbortSignal) {
  return apiRequest<ActivityDto[]>('/activities', { signal })
}

export async function createActivity(body: CreateActivityDto) {
  return apiRequest<ActivityDto>('/activities', {
    method: 'POST',
    body,
  })
}

export async function updateActivity(id: string, body: UpdateActivityDto) {
  return apiRequest<ActivityDto>(`/activities/${id}`, {
    method: 'PUT',
    body,
  })
}

export async function deleteActivity(id: string) {
  return apiRequest<ActivityDto>(`/activities/${id}`, {
    method: 'DELETE',
  })
}
