import { apiRequest } from '@/api/client'
import type { CreateSessionDto, SessionDto, UpdateSessionDto } from '@/api/dtos'

export async function getSessions(signal?: AbortSignal) {
  return apiRequest<SessionDto[]>('/sessions', { signal })
}

export async function createSession(body: CreateSessionDto) {
  return apiRequest<SessionDto>('/sessions', {
    method: 'POST',
    body,
  })
}

export async function updateSession(id: string, body: UpdateSessionDto) {
  return apiRequest<SessionDto>(`/sessions/${id}`, {
    method: 'PUT',
    body,
  })
}
