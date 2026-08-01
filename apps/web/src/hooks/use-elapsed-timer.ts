import { useCallback, useEffect, useRef, useState } from 'react'

import {
  computeElapsedMs,
  computeElapsedSeconds,
  computeRemainingSeconds,
  createElapsedTimerSnapshot,
  isTimerComplete,
  pauseTimer,
  resetTimer,
  setTimerDuration,
  startTimer,
  type ElapsedTimerSnapshot,
} from '@/lib/elapsed-timer'

type UseElapsedTimerOptions = {
  totalDurationMs: number
  persist?: (snapshot: ElapsedTimerSnapshot) => void
  restore?: () => ElapsedTimerSnapshot | null
  onComplete?: (snapshot: ElapsedTimerSnapshot) => void
  tickMs?: number
}

export function useElapsedTimer({
  totalDurationMs,
  persist,
  restore,
  onComplete,
  tickMs = 1000,
}: UseElapsedTimerOptions) {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const completionFiredRef = useRef(false)

  const [snapshot, setSnapshot] = useState<ElapsedTimerSnapshot>(() => {
    const restored = restore?.()
    if (restored) {
      return { ...restored, totalDurationMs: restored.totalDurationMs || totalDurationMs }
    }
    return createElapsedTimerSnapshot(totalDurationMs)
  })

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setSnapshot((current) => {
      if (current.startedAt !== null) return current
      if (current.totalDurationMs === totalDurationMs) return current
      return setTimerDuration(current, totalDurationMs)
    })
  }, [totalDurationMs])

  const persistSnapshot = useCallback(
    (next: ElapsedTimerSnapshot) => {
      persist?.(next)
    },
    [persist],
  )

  const fireCompleteIfNeeded = useCallback((next: ElapsedTimerSnapshot, at = Date.now()) => {
    if (!isTimerComplete(next, at)) return
    if (completionFiredRef.current) return
    completionFiredRef.current = true
    onCompleteRef.current?.(next)
  }, [])

  useEffect(() => {
    const at = Date.now()
    setNow(at)
    fireCompleteIfNeeded(snapshot, at)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount with restored snapshot
  }, [])

  useEffect(() => {
    const shouldTick = snapshot.running || snapshot.pausedAt !== null || snapshot.startedAt !== null
    if (!shouldTick) return

    const interval = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      setSnapshot((current) => {
        if (!current.running) return current
        if (!isTimerComplete(current, at)) return current
        fireCompleteIfNeeded(current, at)
        return { ...current, running: false, pausedAt: null }
      })
    }, tickMs)

    return () => window.clearInterval(interval)
  }, [snapshot.running, snapshot.pausedAt, snapshot.startedAt, tickMs, fireCompleteIfNeeded])

  const updateSnapshot = useCallback(
    (updater: (current: ElapsedTimerSnapshot) => ElapsedTimerSnapshot) => {
      setSnapshot((current) => {
        const next = updater(current)
        persistSnapshot(next)
        return next
      })
    },
    [persistSnapshot],
  )

  const start = useCallback(() => {
    completionFiredRef.current = false
    const at = Date.now()
    updateSnapshot((current) => startTimer({ ...current, totalDurationMs }, at))
    setNow(at)
  }, [totalDurationMs, updateSnapshot])

  const pause = useCallback(() => {
    const at = Date.now()
    updateSnapshot((current) => pauseTimer(current, at))
    setNow(at)
  }, [updateSnapshot])

  const reset = useCallback(() => {
    completionFiredRef.current = false
    updateSnapshot(() => resetTimer(createElapsedTimerSnapshot(totalDurationMs), totalDurationMs))
    setNow(Date.now())
  }, [totalDurationMs, updateSnapshot])

  const remainingSeconds = computeRemainingSeconds(snapshot, now)
  const elapsedSeconds = computeElapsedSeconds(snapshot, now)
  const elapsedMs = computeElapsedMs(snapshot, now)
  const progress = totalDurationMs > 0 ? Math.min(1, elapsedMs / totalDurationMs) : 0

  return {
    snapshot,
    running: snapshot.running,
    remainingSeconds,
    elapsedSeconds,
    progress,
    start,
    pause,
    reset,
    now,
  }
}

export function computeCountUpProgress(snapshot: ElapsedTimerSnapshot, referenceDurationMs: number, now: number) {
  if (referenceDurationMs <= 0 || snapshot.startedAt === null) return 0
  const elapsedMs = computeElapsedMs(snapshot, now)
  return Math.min(1, elapsedMs / referenceDurationMs)
}
