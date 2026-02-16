import { useEffect } from 'react'

import type { UiPreferencesDto } from '@/api/dtos'
import { generateAccentShades, normalizeHexColor } from '@/theme/accent'

const legacyDefaultAccents = new Set(['#e11d77', '#1f1b1d'])
const legacyDefaultBackground = 'radial-gradient(circle at 0% 0%, rgba(253, 220, 229, 0.7), transparent 38%), radial-gradient(circle at 95% 10%, rgba(252, 231, 243, 0.7), transparent 34%)'

export function useUiPersonalization(prefs: UiPreferencesDto | null | undefined) {
  useEffect(() => {
    if (!prefs) return
    const root = document.documentElement
    const normalizedAccent = normalizeHexColor(prefs.accentColor)
    if (normalizedAccent && !legacyDefaultAccents.has(normalizedAccent)) {
      const shades = generateAccentShades(normalizedAccent)
      if (shades) {
        root.style.setProperty('--primary', shades.css.primary)
        root.style.setProperty('--ring', shades.css.ring)
        root.style.setProperty('--chart-1', shades.css.chart1)
        root.style.setProperty('--chart-2', shades.css.chart2)
        root.style.setProperty('--chart-3', shades.css.chart3)
        root.style.setProperty('--card-hover', shades.css.cardHover)
      }
    } else {
      root.style.removeProperty('--primary')
      root.style.removeProperty('--ring')
      root.style.removeProperty('--chart-1')
      root.style.removeProperty('--chart-2')
      root.style.removeProperty('--chart-3')
      root.style.removeProperty('--card-hover')
    }

    const background = prefs.dashboardBackground.trim()
    if (background && background !== legacyDefaultBackground) {
      root.style.setProperty('--user-bg-accent', background)
    } else {
      root.style.removeProperty('--user-bg-accent')
    }
    root.setAttribute('data-density', prefs.layoutDensity)
    root.setAttribute('data-widget-style', prefs.widgetStyle)
  }, [prefs])
}
