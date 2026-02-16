import { apiRequest } from '@/api/client'
import type { MeDto, UpdatePreferencesDto } from '@/api/dtos'

export async function getMe(signal?: AbortSignal) {
  return apiRequest<MeDto>('/me', { signal })
}

export async function updatePreferences(payload: UpdatePreferencesDto) {
  return apiRequest<MeDto>('/me/preferences', {
    method: 'PUT',
    body: payload,
  })
}
