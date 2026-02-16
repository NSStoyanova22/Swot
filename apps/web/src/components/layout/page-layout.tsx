import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageContainerProps = HTMLAttributes<HTMLElement>

export function PageContainer({ className, ...props }: PageContainerProps) {
  return <section className={cn('mx-auto w-full max-w-7xl space-y-6 px-6 py-6', className)} {...props} />
}

type PageHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
  titleClassName?: string
}

export function PageHeader({ title, subtitle, actions, className, titleClassName }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border/70 bg-card/80 p-4 shadow-soft md:flex-row md:items-start md:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className={cn('text-xl font-semibold leading-tight tracking-tight', titleClassName)}>{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">{actions}</div> : null}
    </div>
  )
}

type SectionGridProps = HTMLAttributes<HTMLDivElement>

export function SectionGrid({ className, ...props }: SectionGridProps) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 [&>*]:min-w-0', className)}
      {...props}
    />
  )
}
