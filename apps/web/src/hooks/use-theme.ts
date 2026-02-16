import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { applyTheme, getStoredTheme, normalizeTheme, storeTheme, type AppTheme } from '@/theme/applyTheme'

export const themeOptions = [
  { value: 'pink', label: 'Pink', description: 'Rose accents and warm cards.' },
  { value: 'purple', label: 'Purple', description: 'Vivid violet gradients.' },
  { value: 'dark', label: 'Dark', description: 'Low-light focused contrast.' },
  { value: 'minimal', label: 'Minimal', description: 'Quiet neutral tones.' },
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
