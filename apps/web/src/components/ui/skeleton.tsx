import { motion } from 'framer-motion'

import { cn } from '@/lib/utils'

function Skeleton({ className }: { className?: string }) {
  return (
    <motion.div
      className={cn('rounded-md bg-muted/70', className)}
      animate={{ opacity: [0.45, 0.95, 0.45] }}
      transition={{ duration: 1.25, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
    />
  )
}

export { Skeleton }
