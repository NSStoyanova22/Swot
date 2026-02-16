type UserCourse = {
  id: string
  name: string
}

export type CourseMatchResult = {
  extractedCourseName: string
  matchedCourseId: string | null
  matchedCourseName: string | null
  score: number
}

function normalizeCourseName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = new Array(b.length + 1).fill(0)
  const curr = new Array(b.length + 1).fill(0)

  for (let j = 0; j <= b.length; j += 1) prev[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      )
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }

  return prev[b.length]
}

function similarityScore(a: string, b: string) {
  if (a === b) return 1
  if (!a.length || !b.length) return 0

  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return 0.9 + ratio * 0.1
  }

  const distance = levenshteinDistance(a, b)
  const maxLen = Math.max(a.length, b.length)
  return 1 - distance / maxLen
}

export function matchExtractedCoursesToUserCourses(
  extractedCourseNames: string[],
  userCourses: UserCourse[],
  options?: { threshold?: number },
): CourseMatchResult[] {
  const threshold = options?.threshold ?? 0.55
  const preparedCourses = userCourses.map((course) => ({
    ...course,
    normalized: normalizeCourseName(course.name),
  }))

  return extractedCourseNames.map((extractedCourseName) => {
    const normalizedExtracted = normalizeCourseName(extractedCourseName)

    let bestCourse: UserCourse | null = null
    let bestScore = 0

    for (const course of preparedCourses) {
      const score = similarityScore(normalizedExtracted, course.normalized)
      if (score > bestScore) {
        bestScore = score
        bestCourse = course
      }
    }

    if (!bestCourse || bestScore < threshold) {
      return {
        extractedCourseName,
        matchedCourseId: null,
        matchedCourseName: null,
        score: bestScore,
      }
    }

    return {
      extractedCourseName,
      matchedCourseId: bestCourse.id,
      matchedCourseName: bestCourse.name,
      score: bestScore,
    }
  })
}
