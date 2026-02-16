import { cn } from '@/lib/utils'

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/70', className)} />
}

export { Skeleton }
