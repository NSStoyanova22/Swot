type UserCourse = {
  id: string
  name: string
}

export type CourseMatchResult = {
  extractedCourseName: string
  matchedCourseId: string | null
  matchedCourseName: string | null
  score: number
  debug: {
    normalizedExtracted: string
    normalizedCandidate: string
    levenshteinDistance: number
    tokenScore: number
    charScore: number
    overlapBonus: number
    threshold: number
    formula: string
  }
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function normalizeCourseName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeCourseName(value: string) {
  if (!value) return []
  return value.split(' ').filter(Boolean)
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

function charSimilarity(a: string, b: string) {
  if (!a.length || !b.length) return 0

  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
    return clamp(0.88 + ratio * 0.12)
  }

  const distance = levenshteinDistance(a, b)
  const maxLen = Math.max(a.length, b.length)
  return clamp(1 - distance / maxLen)
}

function tokenOverlapScore(tokensA: string[], tokensB: string[]) {
  if (!tokensA.length || !tokensB.length) return 0

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let exactOverlap = 0
  for (const token of setA) {
    if (setB.has(token)) exactOverlap += 1
  }
  const exactScore = (2 * exactOverlap) / (setA.size + setB.size)

  let fuzzySum = 0
  const [smaller, larger] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA]
  for (const token of smaller) {
    let best = 0
    for (const candidate of larger) {
      const score = charSimilarity(token, candidate)
      if (score > best) best = score
    }
    if (best >= 0.72) fuzzySum += best
  }
  const fuzzyScore = fuzzySum / Math.max(tokensA.length, tokensB.length)

  return Math.max(exactScore, fuzzyScore)
}

function computeSimilarityDetails(a: string, b: string) {
  if (a === b) {
    return {
      score: 1,
      tokenScore: 1,
      charScore: 1,
      overlapBonus: 0,
      levenshteinDistance: 0,
    }
  }
  if (!a.length || !b.length) {
    return {
      score: 0,
      tokenScore: 0,
      charScore: 0,
      overlapBonus: 0,
      levenshteinDistance: Math.max(a.length, b.length),
    }
  }
  const tokensA = tokenizeCourseName(a)
  const tokensB = tokenizeCourseName(b)
  const tokenScore = tokenOverlapScore(tokensA, tokensB)
  const charScore = charSimilarity(a, b)
  const levenshtein = levenshteinDistance(a, b)

  const overlapBonus = tokenScore >= 0.66 ? 0.1 : tokenScore >= 0.5 ? 0.06 : tokenScore >= 0.34 ? 0.03 : 0
  return {
    score: clamp(tokenScore * 0.6 + charScore * 0.4 + overlapBonus),
    tokenScore,
    charScore,
    overlapBonus,
    levenshteinDistance: levenshtein,
  }
}

export function runCourseMatchingDevSelfTest() {
  if (!import.meta.env.DEV) {
    return { ran: false, passed: null as boolean | null, cases: [] as Array<{ label: string; score: number }> }
  }

  const exact = matchExtractedCoursesToUserCourses(
    ['Български език и литература'],
    [{ id: '1', name: 'Български език и литература' }],
    { threshold: 0 },
  )[0]

  const rough = matchExtractedCoursesToUserCourses(
    ['Обектно-ориентирано програмиране'],
    [{ id: '2', name: 'Обектно ориентирано програмиране' }],
    { threshold: 0 },
  )[0]

  const passed = exact.score > 0.9 && rough.score > 0.7
  return {
    ran: true,
    passed,
    cases: [
      { label: 'Български exact match', score: exact.score },
      { label: 'ООП rough variant match', score: rough.score },
    ],
  }
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

    let bestCourse: (UserCourse & { normalized: string }) | null = null
    let bestScore = 0
    let bestDetails = {
      score: 0,
      tokenScore: 0,
      charScore: 0,
      overlapBonus: 0,
      levenshteinDistance: normalizedExtracted.length,
    }

    for (const course of preparedCourses) {
      const details = computeSimilarityDetails(normalizedExtracted, course.normalized)
      const score = details.score
      if (score > bestScore) {
        bestScore = score
        bestCourse = course
        bestDetails = details
      }
    }

    const debugBase = {
      normalizedExtracted,
      normalizedCandidate: bestCourse?.normalized ?? '',
      levenshteinDistance: bestDetails.levenshteinDistance,
      tokenScore: bestDetails.tokenScore,
      charScore: bestDetails.charScore,
      overlapBonus: bestDetails.overlapBonus,
      threshold,
      formula: 'score = clamp(tokenScore*0.6 + charScore*0.4 + overlapBonus)',
    } as const

    if (!bestCourse || bestScore < threshold) {
      return {
        extractedCourseName,
        matchedCourseId: null,
        matchedCourseName: null,
        score: clamp(bestScore),
        debug: debugBase,
      }
    }

    return {
      extractedCourseName,
      matchedCourseId: bestCourse.id,
      matchedCourseName: bestCourse.name,
      score: clamp(bestScore),
      debug: debugBase,
    }
  })
}
