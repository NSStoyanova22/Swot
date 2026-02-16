import { apiRequest } from '@/api/client'
import type { CourseDto, CreateCourseDto, UpdateCourseDto } from '@/api/dtos'

export async function getCourses(signal?: AbortSignal) {
  return apiRequest<CourseDto[]>('/courses', { signal })
}

export async function createCourse(body: CreateCourseDto) {
  return apiRequest<CourseDto>('/courses', {
    method: 'POST',
    body,
  })
}

export async function updateCourse(id: string, body: UpdateCourseDto) {
  return apiRequest<CourseDto>(`/courses/${id}`, {
    method: 'PUT',
    body,
  })
}

export async function deleteCourse(id: string) {
  return apiRequest<CourseDto>(`/courses/${id}`, {
    method: 'DELETE',
  })
}
