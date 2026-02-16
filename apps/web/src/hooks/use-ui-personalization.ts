import { useEffect } from 'react'

import type { UiPreferencesDto } from '@/api/dtos'

function hexToHslTriplet(hex: string) {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return null
  const r = parseInt(normalized.slice(0, 2), 16) / 255
  const g = parseInt(normalized.slice(2, 4), 16) / 255
  const b = parseInt(normalized.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function useUiPersonalization(prefs: UiPreferencesDto | null | undefined) {
  useEffect(() => {
    if (!prefs) return
    const root = document.documentElement
    const hsl = hexToHslTriplet(prefs.accentColor)
    if (hsl) {
      root.style.setProperty('--primary', hsl)
      root.style.setProperty('--ring', hsl)
    }
    root.style.setProperty('--bg-accent', prefs.dashboardBackground)
    root.setAttribute('data-density', prefs.layoutDensity)
    root.setAttribute('data-widget-style', prefs.widgetStyle)
  }, [prefs])
}

