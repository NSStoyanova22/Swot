import { Badge } from '@/components/ui/badge'
import type { GradeScale } from '@/api/dtos'
import { getGradeColor, gradeToNormalizedScore } from '@/features/grades/grade-colors'
import { cn } from '@/lib/utils'

function formatGrade(scale: GradeScale, value: number) {
  if (scale === 'percentage') return `${value.toFixed(1)}%`
  return value.toFixed(2).replace(/\.00$/, '')
}

export function GradeChip({
  scale,
  value,
  className,
  title,
  onClick,
}: {
  scale: GradeScale
  value: number
  className?: string
  title?: string
  onClick?: () => void
}) {
  const color = getGradeColor(scale, value)
  const normalized = gradeToNormalizedScore(scale, value)

  return (
    <Badge
      variant="outline"
      className={cn(
        'border px-2 py-0.5 font-semibold',
        color.bgClass,
        color.textClass,
        color.borderClass,
        onClick ? 'cursor-pointer hover:brightness-110' : '',
        className,
      )}
      style={color.style}
      title={title ?? `Normalized score: ${normalized.toFixed(1)}`}
      onClick={onClick}
    >
      {formatGrade(scale, value)}
    </Badge>
  )
}
