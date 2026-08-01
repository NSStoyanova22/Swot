export type ElapsedTimerSnapshot = {
  startedAt: number | null
  pausedDurationMs: number
  pausedAt: number | null
  running: boolean
  totalDurationMs: number
}

export function createElapsedTimerSnapshot(totalDurationMs: number): ElapsedTimerSnapshot {
  return {
    startedAt: null,
    pausedDurationMs: 0,
    pausedAt: null,
    running: false,
    totalDurationMs,
  }
}

/** Elapsed active time excluding accumulated and current pauses. */
export function computeElapsedMs(snapshot: ElapsedTimerSnapshot, now = Date.now()): number {
  if (snapshot.startedAt === null) return 0
  const endPoint = snapshot.pausedAt ?? now
  return Math.max(0, endPoint - snapshot.startedAt - snapshot.pausedDurationMs)
}

export function computeRemainingMs(snapshot: ElapsedTimerSnapshot, now = Date.now()): number {
  return Math.max(0, snapshot.totalDurationMs - computeElapsedMs(snapshot, now))
}

export function computeRemainingSeconds(snapshot: ElapsedTimerSnapshot, now = Date.now()): number {
  return Math.ceil(computeRemainingMs(snapshot, now) / 1000)
}

export function computeElapsedSeconds(snapshot: ElapsedTimerSnapshot, now = Date.now()): number {
  return Math.floor(computeElapsedMs(snapshot, now) / 1000)
}

export function isTimerComplete(snapshot: ElapsedTimerSnapshot, now = Date.now()): boolean {
  if (snapshot.startedAt === null) return false
  return computeRemainingMs(snapshot, now) <= 0
}

export function startTimer(snapshot: ElapsedTimerSnapshot, now = Date.now()): ElapsedTimerSnapshot {
  if (snapshot.running) return snapshot
  if (snapshot.startedAt === null || isTimerComplete(snapshot, now)) {
    return {
      ...snapshot,
      startedAt: now,
      pausedDurationMs: 0,
      pausedAt: null,
      running: true,
    }
  }
  if (snapshot.pausedAt !== null) {
    return {
      ...snapshot,
      pausedDurationMs: snapshot.pausedDurationMs + (now - snapshot.pausedAt),
      pausedAt: null,
      running: true,
    }
  }
  return { ...snapshot, running: true }
}

export function pauseTimer(snapshot: ElapsedTimerSnapshot, now = Date.now()): ElapsedTimerSnapshot {
  if (!snapshot.running || snapshot.startedAt === null) return snapshot
  return {
    ...snapshot,
    running: false,
    pausedAt: snapshot.pausedAt ?? now,
  }
}

export function resetTimer(snapshot: ElapsedTimerSnapshot, totalDurationMs?: number): ElapsedTimerSnapshot {
  return createElapsedTimerSnapshot(totalDurationMs ?? snapshot.totalDurationMs)
}

export function setTimerDuration(snapshot: ElapsedTimerSnapshot, totalDurationMs: number): ElapsedTimerSnapshot {
  return { ...snapshot, totalDurationMs }
}

/** ISO timestamps for a completed countdown block. */
export function completedCountdownTimes(snapshot: ElapsedTimerSnapshot): { startTime: string; endTime: string } | null {
  if (snapshot.startedAt === null) return null
  const endMs = snapshot.startedAt + snapshot.pausedDurationMs + snapshot.totalDurationMs
  return {
    startTime: new Date(snapshot.startedAt).toISOString(),
    endTime: new Date(endMs).toISOString(),
  }
}

/** ISO timestamps for a count-up (manual) timer at the current elapsed point. */
export function countUpTimes(snapshot: ElapsedTimerSnapshot, now = Date.now()): { startTime: string; endTime: string } | null {
  if (snapshot.startedAt === null) return null
  const elapsedMs = computeElapsedMs(snapshot, now)
  if (elapsedMs <= 0) return null
  return {
    startTime: new Date(snapshot.startedAt).toISOString(),
    endTime: new Date(snapshot.startedAt + snapshot.pausedDurationMs + elapsedMs).toISOString(),
  }
}
