import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Circle, Palette, Pencil, Plus, Trash2 } from 'lucide-react'

import { createActivity, deleteActivity, getActivities, updateActivity } from '@/api/activities'
import { ApiError } from '@/api/client'
import { createCourse, deleteCourse, getCourses, updateCourse } from '@/api/courses'
import { PageContainer, PageHeader } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const activityPalette = ['#ec4899', '#f43f5e', '#fb7185', '#e11d48', '#f97316', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6']
const SELECTED_COURSE_STORAGE_KEY = 'swot-selected-course-id'
const MAX_VISIBLE_COURSES = 4

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (typeof error.details === 'string') return error.details
    if (
      typeof error.details === 'object' &&
      error.details !== null &&
      'error' in error.details &&
      typeof (error.details as { error?: unknown }).error === 'string'
    ) {
      return (error.details as { error: string }).error
    }
  }

  return 'Request failed. Please try again.'
}

function ActivityColorChip({ color, name }: { color: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-1 text-xs">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  )
}

export function CoursesPage() {
  const queryClient = useQueryClient()

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: ({ signal }) => getCourses(signal),
  })
  const activitiesQuery = useQuery({
    queryKey: ['activities'],
    queryFn: ({ signal }) => getActivities(signal),
  })

  const courses = coursesQuery.data ?? []
  const activities = activitiesQuery.data ?? []

  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [newCourseName, setNewCourseName] = useState('')
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null)
  const [editingCourseName, setEditingCourseName] = useState('')

  const [newActivityName, setNewActivityName] = useState('')
  const [newActivityColor, setNewActivityColor] = useState(activityPalette[0])
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [editingActivityName, setEditingActivityName] = useState('')
  const [editingActivityColor, setEditingActivityColor] = useState(activityPalette[0])

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (courses.length === 0) {
      setSelectedCourseId('')
      return
    }

    setSelectedCourseId((current) => {
      if (current && courses.some((course) => course.id === current)) return current
      const storedCourseId =
        typeof window !== 'undefined' ? window.localStorage.getItem(SELECTED_COURSE_STORAGE_KEY) : null
      if (storedCourseId && courses.some((course) => course.id === storedCourseId)) {
        return storedCourseId
      }
      return courses[0].id
    })
  }, [courses])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!selectedCourseId) {
      window.localStorage.removeItem(SELECTED_COURSE_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(SELECTED_COURSE_STORAGE_KEY, selectedCourseId)
  }, [selectedCourseId])

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null
  const shouldShowCourseToggle = courses.length > MAX_VISIBLE_COURSES
  const collapsedVisibleCourses = useMemo(() => {
    if (!shouldShowCourseToggle) return courses
    const firstCourses = courses.slice(0, MAX_VISIBLE_COURSES)
    if (!selectedCourseId || firstCourses.some((course) => course.id === selectedCourseId)) {
      return firstCourses
    }
    const selected = courses.find((course) => course.id === selectedCourseId)
    if (!selected) return firstCourses
    return [...courses.slice(0, MAX_VISIBLE_COURSES - 1), selected]
  }, [courses, selectedCourseId, shouldShowCourseToggle])
  const visibleCourses = isExpanded ? courses : collapsedVisibleCourses
  const hiddenCourseCount = Math.max(0, courses.length - collapsedVisibleCourses.length)
  const selectedActivities = useMemo(
    () => activities.filter((activity) => activity.courseId === selectedCourseId),
    [activities, selectedCourseId],
  )

  useEffect(() => {
    // Keep the activity editor scoped to the currently selected course.
    setEditingActivityId(null)
    setEditingActivityName('')
  }, [selectedCourseId])

  const createCourseMutation = useMutation({
    mutationFn: createCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      setNewCourseName('')
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const updateCourseMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCourse(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      setEditingCourseId(null)
      setEditingCourseName('')
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const deleteCourseMutation = useMutation({
    mutationFn: deleteCourse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const createActivityMutation = useMutation({
    mutationFn: createActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      setNewActivityName('')
      setNewActivityColor(activityPalette[0])
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const updateActivityMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color: string }) =>
      updateActivity(id, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      setEditingActivityId(null)
      setEditingActivityName('')
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const deleteActivityMutation = useMutation({
    mutationFn: deleteActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setError(null)
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  })

  const onCreateCourse = () => {
    const name = newCourseName.trim()
    if (!name) return
    createCourseMutation.mutate({ name })
  }

  const onCreateActivity = () => {
    const name = newActivityName.trim()
    if (!selectedCourseId || !name) return
    createActivityMutation.mutate({
      courseId: selectedCourseId,
      name,
      color: newActivityColor,
    })
  }

  const isLoading = coursesQuery.isPending || activitiesQuery.isPending

  return (
    <PageContainer>
      <PageHeader
        title="📚 Courses"
        subtitle="Create, rename, and manage your course catalog and activities."
        actions={selectedCourse ? <Badge variant="outline">{selectedActivities.length} activities in {selectedCourse.name}</Badge> : null}
      />

      <section className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="min-w-0 h-full shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            📚 Courses
          </CardTitle>
          <CardDescription>Create, rename, and manage your course catalog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={newCourseName}
              onChange={(event) => setNewCourseName(event.target.value)}
              placeholder="New course name"
            />
            <Button onClick={onCreateCourse} disabled={createCourseMutation.isPending || !newCourseName.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading courses...</p> : null}

          <motion.div layout className="relative space-y-2">
            {visibleCourses.map((course) => {
              const courseActivities = activities.filter((activity) => activity.courseId === course.id)
              const isSelected = selectedCourseId === course.id
              const isEditing = editingCourseId === course.id

              return (
                <motion.div
                  layout
                  key={course.id}
                  className={cn(
                    'cursor-pointer rounded-lg border border-border/70 bg-background/75 p-3 transition-colors',
                    isSelected && 'border-primary/50 bg-primary/5',
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (isEditing) return
                    setSelectedCourseId(course.id)
                  }}
                  onKeyDown={(event) => {
                    if (isEditing) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedCourseId(course.id)
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    {isEditing ? (
                      <Input
                        value={editingCourseName}
                        onChange={(event) => setEditingCourseName(event.target.value)}
                        className="h-8"
                      />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="text-left text-sm font-medium"
                          onClick={() => setSelectedCourseId(course.id)}
                        >
                          {course.name}
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          title="Edit name"
                          aria-label={`Edit name for ${course.name}`}
                          onClick={() => {
                            setSelectedCourseId(course.id)
                            setEditingCourseId(course.id)
                            setEditingCourseName(course.name)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => updateCourseMutation.mutate({ id: course.id, name: editingCourseName.trim() })}
                            disabled={!editingCourseName.trim() || updateCourseMutation.isPending}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => {
                              setEditingCourseId(null)
                              setEditingCourseName('')
                            }}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteCourseMutation.mutate(course.id)
                          }}
                          disabled={deleteCourseMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{courseActivities.length} activities</Badge>
                    {courseActivities.slice(0, 3).map((activity) => (
                      <ActivityColorChip key={activity.id} color={activity.color} name={activity.name} />
                    ))}
                    {courseActivities.length > 3 ? (
                      <Badge variant="outline">+{courseActivities.length - 3}</Badge>
                    ) : null}
                  </div>
                </motion.div>
              )
            })}

            {!isExpanded && shouldShowCourseToggle && hiddenCourseCount > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card via-card/90 to-transparent" />
            ) : null}

            {courses.length === 0 && !isLoading ? (
              <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
                No courses yet. Create your first course to get started.
              </div>
            ) : null}
          </motion.div>

          {shouldShowCourseToggle ? (
            <motion.button
              layout
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              className="inline-flex items-center rounded-md border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isExpanded ? 'Show less' : `See all ${courses.length} courses`}
            </motion.button>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

        <Card className="min-w-0 h-full shadow-soft">
          <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            Activities {selectedCourse ? `for ${selectedCourse.name}` : ''}
          </CardTitle>
          <CardDescription>CRUD activities and assign color chips used in views and charts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {courses.length > 0 ? (
            <div className="space-y-1">
              <label htmlFor="activities-course-select" className="text-xs font-medium text-muted-foreground">
                Course
              </label>
              <Select
                value={selectedCourseId}
                onValueChange={setSelectedCourseId}
              >
                <SelectTrigger id="activities-course-select" aria-label="Select course for activities">
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {selectedCourse ? (
            <>
              <div className="rounded-lg border border-border/70 bg-background/75 p-3">
                <p className="mb-2 text-sm font-medium">New activity</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={newActivityName}
                    onChange={(event) => setNewActivityName(event.target.value)}
                    placeholder="Activity name"
                    className="max-w-xs"
                  />
                  <div className="flex flex-wrap gap-1">
                    {activityPalette.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'grid h-7 w-7 place-items-center rounded-full border-2',
                          newActivityColor === color ? 'border-foreground' : 'border-transparent',
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewActivityColor(color)}
                        aria-label={`Select color ${color}`}
                      >
                        {newActivityColor === color ? <Circle className="h-3 w-3 fill-white text-white" /> : null}
                      </button>
                    ))}
                  </div>
                  <Button
                    onClick={onCreateActivity}
                    disabled={!newActivityName.trim() || createActivityMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {selectedActivities.map((activity) => {
                  const isEditing = editingActivityId === activity.id

                  return (
                    <div key={activity.id} className="rounded-lg border border-border/70 bg-background/75 p-3">
                      {isEditing ? (
                        <div className="space-y-3">
                          <Input
                            value={editingActivityName}
                            onChange={(event) => setEditingActivityName(event.target.value)}
                            className="max-w-xs"
                          />
                          <div className="flex flex-wrap gap-1">
                            {activityPalette.map((color) => (
                              <button
                                key={color}
                                type="button"
                                className={cn(
                                  'grid h-7 w-7 place-items-center rounded-full border-2',
                                  editingActivityColor === color ? 'border-foreground' : 'border-transparent',
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => setEditingActivityColor(color)}
                              >
                                {editingActivityColor === color ? (
                                  <Circle className="h-3 w-3 fill-white text-white" />
                                ) : null}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                updateActivityMutation.mutate({
                                  id: activity.id,
                                  name: editingActivityName.trim(),
                                  color: editingActivityColor,
                                })
                              }
                              disabled={!editingActivityName.trim() || updateActivityMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingActivityId(null)
                                setEditingActivityName('')
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <ActivityColorChip color={activity.color} name={activity.name} />
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingActivityId(activity.id)
                                setEditingActivityName(activity.name)
                                setEditingActivityColor(activity.color)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteActivityMutation.mutate(activity.id)}
                              disabled={deleteActivityMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {selectedActivities.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
                    No activities yet for this course.
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
              Create your first course to add activities.
            </div>
          )}
          </CardContent>
        </Card>
      </section>
    </PageContainer>
  )
}
