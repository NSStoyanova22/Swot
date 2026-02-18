import type { CSSProperties } from 'react'

import type { GradeScale } from '@/api/dtos'

const COLOR_STOPS = [
  { at: 0, rgb: [239, 68, 68] as const }, // red
  { at: 25, rgb: [249, 115, 22] as const }, // orange
  { at: 50, rgb: [234, 179, 8] as const }, // yellow
  { at: 75, rgb: [132, 204, 22] as const }, // light green
  { at: 100, rgb: [34, 197, 94] as const }, // green
] as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function gradeToNormalizedScore(scale: GradeScale, value: number) {
  if (!Number.isFinite(value)) return 0
  if (scale === 'bulgarian') {
    return clamp(((value - 2) / 4) * 100, 0, 100)
  }
  if (scale === 'german') {
    return clamp(((6 - value) / 5) * 100, 0, 100)
  }
  return clamp(value, 0, 100)
}

function interpolateColorAt(percent: number) {
  const p = clamp(percent, 0, 100)
  const upperIndex = COLOR_STOPS.findIndex((stop) => p <= stop.at)
  if (upperIndex <= 0) return COLOR_STOPS[0]!.rgb
  if (upperIndex === -1) return COLOR_STOPS[COLOR_STOPS.length - 1]!.rgb

  const left = COLOR_STOPS[upperIndex - 1]!
  const right = COLOR_STOPS[upperIndex]!
  const range = right.at - left.at
  const t = range <= 0 ? 0 : (p - left.at) / range

  const r = Math.round(left.rgb[0] + (right.rgb[0] - left.rgb[0]) * t)
  const g = Math.round(left.rgb[1] + (right.rgb[1] - left.rgb[1]) * t)
  const b = Math.round(left.rgb[2] + (right.rgb[2] - left.rgb[2]) * t)
  return [r, g, b] as const
}

export function getGradeColor(scale: GradeScale, value: number): {
  bgClass: string
  textClass: string
  borderClass: string
  style: CSSProperties
} {
  const normalized = gradeToNormalizedScore(scale, value)
  const [r, g, b] = interpolateColorAt(normalized)
  const rgb = `${r} ${g} ${b}`

  return {
    bgClass: 'bg-[color:rgb(var(--grade-chip-rgb)_/_0.16)] dark:bg-[color:rgb(var(--grade-chip-rgb)_/_0.22)]',
    textClass: 'text-[color:rgb(var(--grade-chip-rgb)_/_0.98)] dark:text-[color:rgb(var(--grade-chip-rgb)_/_0.9)]',
    borderClass: 'border-[color:rgb(var(--grade-chip-rgb)_/_0.5)] dark:border-[color:rgb(var(--grade-chip-rgb)_/_0.62)]',
    style: {
      '--grade-chip-rgb': rgb,
    } as CSSProperties,
  }
}
