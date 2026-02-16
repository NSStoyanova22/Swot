import { useEffect, useMemo, useState } from 'react'

export const themeOptions = [
  { value: 'pink', label: 'Pink', description: 'Rose accents and warm cards.' },
  { value: 'purple', label: 'Purple', description: 'Vivid violet gradients.' },
  { value: 'dark', label: 'Dark', description: 'Low-light focused contrast.' },
  { value: 'minimal', label: 'Minimal', description: 'Quiet neutral tones.' },
] as const

export type ThemeName = (typeof themeOptions)[number]['value']

const THEME_STORAGE_KEY = 'swot-theme'

function normalizeTheme(value: string | null): ThemeName {
  if (value === 'pink' || value === 'purple' || value === 'dark' || value === 'minimal') return value
  if (value === 'neutral') return 'minimal'
  return 'pink'
}

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'pink'
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => getStoredTheme())

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    window.dispatchEvent(new CustomEvent('swot:theme-change', { detail: { theme } }))
  }, [theme])

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const custom = event as CustomEvent<{ theme?: ThemeName }>
      if (!custom.detail?.theme) return
      setTheme(normalizeTheme(custom.detail.theme))
    }
    window.addEventListener('swot:theme-change', onThemeChange)
    return () => window.removeEventListener('swot:theme-change', onThemeChange)
  }, [])

  return useMemo(
    () => ({
      theme,
      setTheme,
      options: themeOptions,
    }),
    [theme],
  )
}
