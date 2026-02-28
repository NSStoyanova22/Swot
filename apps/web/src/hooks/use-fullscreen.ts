import { useCallback, useEffect, useMemo, useState } from 'react'

export const TIMER_FULLSCREEN_CHANGE_EVENT = 'timer-fullscreen-change'
export const TIMER_FULLSCREEN_BODY_CLASS = 'timer-fullscreen-active'

function emitFullscreenChange(active: boolean) {
  window.dispatchEvent(new CustomEvent(TIMER_FULLSCREEN_CHANGE_EVENT, { detail: { active } }))
}

export function useFullscreen() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState(false)

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsNativeFullscreen(document.fullscreenElement === document.documentElement)
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  const isSupported = useMemo(() => {
    if (typeof document === 'undefined') return false
    return (
      typeof document.documentElement.requestFullscreen === 'function' &&
      typeof document.exitFullscreen === 'function'
    )
  }, [])

  const enter = useCallback(async () => {
    if (!isSupported) {
      setIsFallbackFullscreen(true)
      return
    }

    try {
      await document.documentElement.requestFullscreen()
      setIsFallbackFullscreen(false)
    } catch {
      // Browser denied native fullscreen (permissions, policy, or gesture). Use CSS fallback.
      setIsFallbackFullscreen(true)
    }
  }, [isSupported])

  const exit = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        // Ignore exit errors and still clear fallback mode.
      }
    }

    setIsFallbackFullscreen(false)
  }, [])

  const isFullscreen = isNativeFullscreen || isFallbackFullscreen

  const toggle = useCallback(async () => {
    if (isFullscreen) {
      await exit()
      return
    }

    await enter()
  }, [enter, exit, isFullscreen])

  useEffect(() => {
    if (isNativeFullscreen) {
      setIsFallbackFullscreen(false)
    }
  }, [isNativeFullscreen])

  useEffect(() => {
    document.body.classList.toggle(TIMER_FULLSCREEN_BODY_CLASS, isFullscreen)
    emitFullscreenChange(isFullscreen)
  }, [isFullscreen])

  useEffect(
    () => () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined)
      }
      document.body.classList.remove(TIMER_FULLSCREEN_BODY_CLASS)
      emitFullscreenChange(false)
    },
    [],
  )

  useEffect(() => {
    if (!isFallbackFullscreen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsFallbackFullscreen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFallbackFullscreen])

  return {
    enter,
    exit,
    isFallbackFullscreen,
    isFullscreen,
    isNativeFullscreen,
    isSupported,
    toggle,
  }
}
