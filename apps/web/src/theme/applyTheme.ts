export const THEME_STORAGE_KEY = 'swot.theme'
const LEGACY_THEME_STORAGE_KEY = 'swot-theme'
const DEFAULT_THEME = 'soft-rose'

const validThemes = ['system', 'soft-rose', 'midnight', 'ocean-calm', 'forest-focus', 'minimal-light', 'violet-studio'] as const

export type AppTheme = (typeof validThemes)[number]

export function normalizeTheme(value: string | null | undefined): AppTheme {
  if (value === 'system') return 'system'
  if (value === 'pink') return 'soft-rose'
  if (value === 'dark') return 'midnight'
  if (value === 'minimal' || value === 'neutral') return 'minimal-light'
  if (value === 'purple') return 'violet-studio'
  return validThemes.includes(value as AppTheme) ? (value as AppTheme) : DEFAULT_THEME
}

export function resolveTheme(theme: AppTheme) {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined') return 'minimal-light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'minimal-light'
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  const resolvedTheme = resolveTheme(theme)
  document.documentElement.setAttribute('data-theme', resolvedTheme)
  document.documentElement.setAttribute('data-theme-mode', theme)
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
