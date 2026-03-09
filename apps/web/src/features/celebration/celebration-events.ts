export type CelebrationType =
  | 'gradeItem'
  | 'termFinal'
  | 'courseAverage'
  | 'sessionCompleted'
  | 'streakMilestone'

export type CelebrationPayload = {
  type: CelebrationType
  courseId: string
  courseName: string
  score: number
  gradeValue?: number | null
  termId?: string
  message?: string
}

type Listener = (payload: CelebrationPayload) => void

const listeners = new Set<Listener>()

export function notifyCelebration(payload: CelebrationPayload) {
  listeners.forEach((listener) => listener(payload))
}

export function subscribeCelebration(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
