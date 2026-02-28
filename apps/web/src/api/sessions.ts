import { apiRequest } from '@/api/client'
import type { CourseDto, CreateSessionDto, SessionDto, UpdateSessionDto } from '@/api/dtos'

type SessionsQuery = {
  from?: string
  to?: string
  courseId?: string
  q?: string
}

type QueuedSessionRecord = {
  id: string
  fingerprint: string
  createdAt: string
  payload: CreateSessionDto
}

type SyncState = {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

const OFFLINE_QUEUE_KEY = 'swot-offline-session-queue-v1'
const OFFLINE_SYNCED_KEY = 'swot-offline-session-synced-v1'
const SYNCED_TTL_MS = 7 * 24 * 60 * 60 * 1000

let syncInFlight: Promise<void> | null = null
let syncState: SyncState = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  isSyncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
}
const listeners = new Set<(state: SyncState) => void>()

function emitSyncState() {
  listeners.forEach((listener) => listener(syncState))
}

function updateSyncState(next: Partial<SyncState>) {
  syncState = { ...syncState, ...next }
  emitSyncState()
}

function readQueue() {
  if (typeof window === 'undefined') return [] as QueuedSessionRecord[]
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedSessionRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(records: QueuedSessionRecord[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(records))
  updateSyncState({ pendingCount: records.length })
}

function readSyncedFingerprints() {
  if (typeof window === 'undefined') return {} as Record<string, number>
  try {
    const raw = window.localStorage.getItem(OFFLINE_SYNCED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed ?? {}
  } catch {
    return {}
  }
}

function writeSyncedFingerprints(values: Record<string, number>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OFFLINE_SYNCED_KEY, JSON.stringify(values))
}

function pruneSyncedFingerprints() {
  const now = Date.now()
  const current = readSyncedFingerprints()
  const next: Record<string, number> = {}
  for (const [fingerprint, timestamp] of Object.entries(current)) {
    if (now - timestamp <= SYNCED_TTL_MS) next[fingerprint] = timestamp
  }
  writeSyncedFingerprints(next)
  return next
}

function normalizeNote(value: string | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function sessionFingerprint(payload: CreateSessionDto) {
  const activityId = payload.activityId ?? ''
  const taskId = payload.taskId ?? ''
  const breakMinutes = Number(payload.breakMinutes ?? 0)
  return [
    payload.courseId,
    activityId,
    taskId,
    new Date(payload.startTime).toISOString(),
    new Date(payload.endTime).toISOString(),
    String(breakMinutes),
    normalizeNote(payload.note),
  ].join('|')
}

function generateQueuedId() {
  return `offline-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function buildPlaceholderCourse(courseId: string): CourseDto {
  const now = new Date().toISOString()
  return {
    id: courseId,
    userId: 'swot-user',
    name: 'Pending sync',
    createdAt: now,
    updatedAt: now,
  }
}

function buildQueuedSessionDto(payload: CreateSessionDto, queuedId: string): SessionDto {
  const now = new Date().toISOString()
  const duration = Math.max(
    0,
    Math.round((new Date(payload.endTime).getTime() - new Date(payload.startTime).getTime()) / 60000) -
      Number(payload.breakMinutes ?? 0),
  )

  return {
    id: queuedId,
    userId: 'swot-user',
    courseId: payload.courseId,
    activityId: payload.activityId ?? null,
    startTime: new Date(payload.startTime).toISOString(),
    endTime: new Date(payload.endTime).toISOString(),
    breakMinutes: Number(payload.breakMinutes ?? 0),
    durationMinutes: duration,
    note: payload.note?.trim() || null,
    createdAt: now,
    updatedAt: now,
    course: buildPlaceholderCourse(payload.courseId),
    activity: null,
  }
}

function shouldQueueError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (error instanceof TypeError) return true
  return false
}

async function enqueueSession(payload: CreateSessionDto) {
  const fingerprint = sessionFingerprint(payload)
  const queue = readQueue()
  const existing = queue.find((item) => item.fingerprint === fingerprint)
  if (existing) {
    return buildQueuedSessionDto(existing.payload, existing.id)
  }

  const record: QueuedSessionRecord = {
    id: generateQueuedId(),
    fingerprint,
    createdAt: new Date().toISOString(),
    payload: {
      ...payload,
      startTime: new Date(payload.startTime).toISOString(),
      endTime: new Date(payload.endTime).toISOString(),
      taskId: payload.taskId ?? undefined,
      note: payload.note?.trim() || undefined,
      breakMinutes: Number(payload.breakMinutes ?? 0),
    },
  }

  writeQueue([...queue, record])
  return buildQueuedSessionDto(record.payload, record.id)
}

function serverSessionFingerprint(session: SessionDto) {
  return sessionFingerprint({
    courseId: session.courseId,
    activityId: session.activityId ?? undefined,
    taskId: undefined,
    startTime: session.startTime,
    endTime: session.endTime,
    breakMinutes: session.breakMinutes,
    note: session.note ?? undefined,
  })
}

function isDuplicateAgainstRemote(
  record: QueuedSessionRecord,
  remoteFingerprints: Set<string>,
  syncedFingerprints: Record<string, number>,
) {
  return remoteFingerprints.has(record.fingerprint) || Boolean(syncedFingerprints[record.fingerprint])
}

export function subscribeSessionSync(listener: (state: SyncState) => void) {
  listeners.add(listener)
  listener(syncState)
  return () => {
    listeners.delete(listener)
  }
}

export function getSessionSyncState() {
  const queue = readQueue()
  if (queue.length !== syncState.pendingCount) {
    updateSyncState({ pendingCount: queue.length })
  }
  return syncState
}

export async function syncQueuedSessions() {
  if (typeof window === 'undefined') return
  if (syncInFlight) return syncInFlight
  if (!navigator.onLine) {
    updateSyncState({ isOnline: false, lastError: 'Offline' })
    return
  }

  syncInFlight = (async () => {
    try {
      updateSyncState({ isOnline: true, isSyncing: true, lastError: null })

      const queue = readQueue()
      if (queue.length === 0) {
        updateSyncState({ isSyncing: false, pendingCount: 0, lastSyncedAt: new Date().toISOString() })
        return
      }

      const syncedFingerprints = pruneSyncedFingerprints()
      const remoteSessions = await getSessions({})
      const remoteFingerprints = new Set(remoteSessions.map(serverSessionFingerprint))

      const remaining: QueuedSessionRecord[] = []
      const syncedUpdates: Record<string, number> = { ...syncedFingerprints }

      for (const item of queue) {
        if (isDuplicateAgainstRemote(item, remoteFingerprints, syncedUpdates)) {
          continue
        }

        try {
          await apiRequest<SessionDto>('/sessions', {
            method: 'POST',
            body: item.payload,
          })
          syncedUpdates[item.fingerprint] = Date.now()
        } catch (error) {
          if (shouldQueueError(error)) {
            remaining.push(item)
            updateSyncState({ isOnline: false, lastError: 'Still offline' })
            break
          }

          remaining.push(item)
          updateSyncState({ lastError: 'Some sessions could not sync' })
        }
      }

      writeSyncedFingerprints(syncedUpdates)
      writeQueue(remaining)
      updateSyncState({
        isOnline: navigator.onLine,
        isSyncing: false,
        pendingCount: remaining.length,
        lastSyncedAt: new Date().toISOString(),
      })
    } catch {
      updateSyncState({
        isSyncing: false,
        isOnline: navigator.onLine,
        pendingCount: readQueue().length,
        lastError: 'Sync check failed',
      })
    }
  })()

  try {
    await syncInFlight
  } finally {
    syncInFlight = null
  }
}

export async function getSessions(query: SessionsQuery = {}, signal?: AbortSignal) {
  return apiRequest<SessionDto[]>('/sessions', { query, signal })
}

export async function createSession(body: CreateSessionDto) {
  const payload: CreateSessionDto = {
    ...body,
    startTime: new Date(body.startTime).toISOString(),
    endTime: new Date(body.endTime).toISOString(),
    taskId: body.taskId ?? undefined,
    note: body.note?.trim() || undefined,
    breakMinutes: Number(body.breakMinutes ?? 0),
  }

  try {
    const created = await apiRequest<SessionDto>('/sessions', {
      method: 'POST',
      body: payload,
    })
    updateSyncState({
      isOnline: true,
      lastError: null,
      lastSyncedAt: new Date().toISOString(),
      pendingCount: readQueue().length,
    })
    return created
  } catch (error) {
    if (!shouldQueueError(error)) {
      throw error
    }

    updateSyncState({ isOnline: false, lastError: 'Offline: session queued for sync' })
    return enqueueSession(payload)
  }
}

export async function updateSession(id: string, body: UpdateSessionDto) {
  return apiRequest<SessionDto>(`/sessions/${id}`, {
    method: 'PUT',
    body,
  })
}
