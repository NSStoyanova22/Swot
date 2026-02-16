import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { getSessionSyncState, subscribeSessionSync, syncQueuedSessions } from '@/api/sessions'

let syncManagerStarted = false

export function useSessionSync() {
  const queryClient = useQueryClient()
  const state = useSyncExternalStore(subscribeSessionSync, getSessionSyncState, getSessionSyncState)

  useEffect(() => {
    if (syncManagerStarted) return
    syncManagerStarted = true

    const refreshFromSync = async () => {
      const before = getSessionSyncState().pendingCount
      await syncQueuedSessions()
      const after = getSessionSyncState().pendingCount
      if (after < before) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['streak'] })
        queryClient.invalidateQueries({ queryKey: ['productivity'] })
        queryClient.invalidateQueries({ queryKey: ['planner-blocks'] })
        queryClient.invalidateQueries({ queryKey: ['planner-overview'] })
      }
    }

    const onOnline = () => {
      void refreshFromSync()
    }

    const onOffline = () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    const interval = window.setInterval(() => {
      if (!navigator.onLine) return
      void refreshFromSync()
    }, 20_000)

    void refreshFromSync()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(interval)
      syncManagerStarted = false
    }
  }, [queryClient])

  return {
    ...state,
    syncNow: syncQueuedSessions,
  }
}
