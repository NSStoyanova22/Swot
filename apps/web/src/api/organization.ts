import { apiRequest } from '@/api/client'
import type {
  CreateOrganizationReminderDto,
  CreateOrganizationScheduleBlockDto,
  CreateOrganizationTaskDto,
  OrganizationReminderDto,
  OrganizationScheduleBlockDto,
  OrganizationTaskDto,
  OrganizationUnifiedItemDto,
  UpdateOrganizationTaskDto,
} from '@/api/dtos'

type RangeQuery = {
  from?: string
  to?: string
}

export async function getOrganizationTasks(query: RangeQuery = {}, signal?: AbortSignal) {
  return apiRequest<OrganizationTaskDto[]>('/organization/tasks', {
    query,
    signal,
  })
}

export async function createOrganizationTask(payload: CreateOrganizationTaskDto) {
  return apiRequest<OrganizationTaskDto>('/organization/tasks', {
    method: 'POST',
    body: payload,
  })
}

export async function updateOrganizationTask(id: string, payload: UpdateOrganizationTaskDto) {
  return apiRequest<OrganizationTaskDto>(`/organization/tasks/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export async function deleteOrganizationTask(id: string) {
  return apiRequest<{ ok: boolean }>(`/organization/tasks/${id}`, {
    method: 'DELETE',
  })
}

export async function createTaskSubtask(taskId: string, title: string) {
  return apiRequest<{ id: string; taskId: string; title: string; done: boolean; sortOrder: number }>(
    `/organization/tasks/${taskId}/subtasks`,
    {
      method: 'POST',
      body: { title },
    },
  )
}

export async function updateTaskSubtask(taskId: string, subtaskId: string, payload: { title?: string; done?: boolean; sortOrder?: number }) {
  return apiRequest<{ id: string; taskId: string; title: string; done: boolean; sortOrder: number }>(
    `/organization/tasks/${taskId}/subtasks/${subtaskId}`,
    {
      method: 'PUT',
      body: payload,
    },
  )
}

export async function getOrganizationReminders(signal?: AbortSignal) {
  return apiRequest<OrganizationReminderDto[]>('/organization/reminders', { signal })
}

export async function createOrganizationReminder(payload: CreateOrganizationReminderDto) {
  return apiRequest<{ id: string }>('/organization/reminders', {
    method: 'POST',
    body: payload,
  })
}

export async function getOrganizationScheduleBlocks(signal?: AbortSignal) {
  return apiRequest<OrganizationScheduleBlockDto[]>('/organization/schedule-blocks', { signal })
}

export async function createOrganizationScheduleBlock(payload: CreateOrganizationScheduleBlockDto) {
  return apiRequest<{ id: string }>('/organization/schedule-blocks', {
    method: 'POST',
    body: payload,
  })
}

export async function getOrganizationUnified(query: RangeQuery = {}, signal?: AbortSignal) {
  return apiRequest<OrganizationUnifiedItemDto[]>('/organization/unified', {
    query,
    signal,
  })
}
