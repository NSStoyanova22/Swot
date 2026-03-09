import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { subscribeCelebration, type CelebrationPayload } from '@/features/celebration/celebration-events'

const sparkleCount = 14

export function CelebrationOverlay() {
  const [active, setActive] = useState<CelebrationPayload | null>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    return subscribeCelebration((payload) => {
      setActive(payload)
      window.setTimeout(() => {
        setActive((current) => (current?.courseId === payload.courseId && current?.type === payload.type ? null : current))
      }, 2500)
    })
  }, [])

  const sparkles = useMemo(
    () =>
      Array.from({ length: sparkleCount }).map((_, index) => ({
        id: index,
        x: Math.random() * 220 - 110,
        y: -Math.random() * 90 - 12,
        delay: Math.random() * 0.22,
        duration: 0.7 + Math.random() * 0.5,
      })),
    [active?.courseId, active?.score, active?.type],
  )

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          key={`${active.courseId}-${active.type}-${active.score}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed right-4 top-4 z-[70] w-[min(92vw,360px)]"
        >
          <div className="pointer-events-auto relative overflow-hidden rounded-xl border border-emerald-500/30 bg-background/95 p-3 shadow-soft backdrop-blur-sm">
            {!prefersReducedMotion
              ? sparkles.map((sparkle) => (
                  <motion.span
                    key={`sparkle-${sparkle.id}`}
                    className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-emerald-400/90"
                    initial={{ opacity: 0, scale: 0.5, x: 0, y: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0.5, 1.1, 0.3],
                      x: sparkle.x,
                      y: sparkle.y,
                    }}
                    transition={{
                      duration: sparkle.duration,
                      delay: sparkle.delay,
                      ease: 'easeOut',
                    }}
                  />
                ))
              : null}
            <p className="text-sm font-semibold text-foreground">
              {active.type === 'sessionCompleted'
                ? 'Focus session complete'
                : active.type === 'streakMilestone'
                  ? 'Streak milestone'
                  : active.type === 'courseAverage'
                    ? 'Nice work'
                    : 'Excellent result'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{active.courseName || 'Great outcome'}</p>
            {Number.isFinite(active.score) ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {active.gradeValue != null ? `${active.gradeValue} · ` : ''}
                {`${active.score.toFixed(1)} score`}
              </p>
            ) : null}
            {active.message ? <p className="mt-1 text-xs text-muted-foreground">{active.message}</p> : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
