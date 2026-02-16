export const THEME_STORAGE_KEY = 'swot.theme'
const LEGACY_THEME_STORAGE_KEY = 'swot-theme'
const DEFAULT_THEME = 'pink'

const validThemes = ['pink', 'purple', 'dark', 'minimal'] as const

export type AppTheme = (typeof validThemes)[number]

export function normalizeTheme(value: string | null | undefined): AppTheme {
  if (value === 'neutral') return 'minimal'
  return validThemes.includes(value as AppTheme) ? (value as AppTheme) : DEFAULT_THEME
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

export function getStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try {
    const next = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (next) return normalizeTheme(next)

    const legacy = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
    if (legacy) return normalizeTheme(legacy)
  } catch {
    return DEFAULT_THEME
  }
  return DEFAULT_THEME
}

export function storeTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
  } catch {
    // Ignore storage quota/privacy mode errors.
  }
}

export function initializeTheme() {
  const theme = getStoredTheme()
  applyTheme(theme)
  storeTheme(theme)
  return theme
}
