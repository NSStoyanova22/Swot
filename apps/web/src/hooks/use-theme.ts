import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { applyTheme, getStoredTheme, normalizeTheme, storeTheme, type AppTheme } from '@/theme/applyTheme'

export const themeOptions = [
  { value: 'system', label: 'System', description: 'Follow your OS light/dark appearance.', preview: ['#111827', '#f8fafc', '#60a5fa'] },
  { value: 'soft-rose', label: 'Soft Rose', description: 'Pastel rose accents and neutral cards.', preview: ['#e11d77', '#fda4af', '#fde7f3'] },
  { value: 'midnight', label: 'Midnight', description: 'Premium charcoal dark with vivid highlights.', preview: ['#f472b6', '#a78bfa', '#111827'] },
  { value: 'ocean-calm', label: 'Ocean Calm', description: 'Deep blue surfaces with cyan accents.', preview: ['#06b6d4', '#3b82f6', '#0b1d33'] },
  { value: 'forest-focus', label: 'Forest Focus', description: 'Dark green, calm, and minimal.', preview: ['#22c55e', '#10b981', '#13251b'] },
  { value: 'minimal-light', label: 'Minimal Light', description: 'Clean, neutral, Notion-style light theme.', preview: ['#374151', '#9ca3af', '#f8fafc'] },
  { value: 'violet-studio', label: 'Violet Studio', description: 'Modern dev-tool purple aesthetic.', preview: ['#7c3aed', '#ec4899', '#ddd6fe'] },
] as const

export type ThemeName = (typeof themeOptions)[number]['value']

type ThemeContextValue = {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  options: typeof themeOptions
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(theme as AppTheme)
    storeTheme(theme as AppTheme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (nextTheme) => setThemeState(normalizeTheme(nextTheme)),
      options: themeOptions,
    }),
    [theme],
  )

  return createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
