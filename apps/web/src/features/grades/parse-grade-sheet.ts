export type ParsedGradeRow = {
  courseName: string
  gradeValue: number
}

export function parseGradeSheetLine(line: string): ParsedGradeRow | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^(.+?)\s+([-+]?\d+(?:[.,]\d+)?)$/)
  if (!match) return null

  const courseName = match[1].trim()
  const gradeValue = Number(match[2].replace(',', '.'))
  if (!courseName || !Number.isFinite(gradeValue)) return null

  return { courseName, gradeValue }
}

export function parseGradeSheetText(text: string): ParsedGradeRow[] {
  return text
    .split('\n')
    .map((line) => parseGradeSheetLine(line))
    .filter((row): row is ParsedGradeRow => row !== null)
}
