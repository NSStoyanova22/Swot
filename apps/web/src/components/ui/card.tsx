import * as React from 'react'
import { motion } from 'framer-motion'

import { cn } from '@/lib/utils'

type CardProps = React.ComponentProps<'div'> & {
  hoverEffect?: boolean
}

function Card({ className, hoverEffect = true, ...props }: CardProps) {
  return (
    <motion.div
      whileHover={hoverEffect ? { y: -3, scale: 1.004, boxShadow: '0 14px 32px rgba(15, 23, 42, 0.12)' } : undefined}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        data-slot="card"
        className={cn(
          'rounded-xl border border-border/60 bg-card/95 text-card-foreground shadow-sm backdrop-blur-sm transition-all',
          className,
        )}
        {...props}
      />
    </motion.div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col space-y-1.5 p-5', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-5 pt-0', className)} {...props} />
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle }
