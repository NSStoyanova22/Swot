export type FocusSoundId = 'white' | 'rain' | 'cafe' | 'brown' | 'youtube'

export type FocusSoundPreferences = {
  selectedSound: FocusSoundId
  volume: number
  youtubeUrl: string
}

const STORAGE_KEY = 'swot-focus-sound-preferences-v1'
const CHANGE_EVENT = 'swot:focus-sound-preferences'

const defaultPreferences: FocusSoundPreferences = {
  selectedSound: 'white',
  volume: 0.55,
  youtubeUrl: 'https://www.youtube.com/embed/jfKfPfyJRdk',
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizePreferences(input: Partial<FocusSoundPreferences> | null | undefined): FocusSoundPreferences {
  const selectedSound = input?.selectedSound
  const sound: FocusSoundId =
    selectedSound === 'white' ||
    selectedSound === 'rain' ||
    selectedSound === 'cafe' ||
    selectedSound === 'brown' ||
    selectedSound === 'youtube'
      ? selectedSound
      : defaultPreferences.selectedSound

  return {
    selectedSound: sound,
    volume: clamp(Number(input?.volume ?? defaultPreferences.volume), 0, 1),
    youtubeUrl: String(input?.youtubeUrl ?? defaultPreferences.youtubeUrl).trim() || defaultPreferences.youtubeUrl,
  }
}

export function getFocusSoundPreferences(): FocusSoundPreferences {
  if (typeof window === 'undefined') return defaultPreferences
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPreferences
    const parsed = JSON.parse(raw) as Partial<FocusSoundPreferences>
    return normalizePreferences(parsed)
  } catch {
    return defaultPreferences
  }
}

export function setFocusSoundPreferences(next: Partial<FocusSoundPreferences>) {
  if (typeof window === 'undefined') return defaultPreferences
  const current = getFocusSoundPreferences()
  const merged = normalizePreferences({ ...current, ...next })
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: merged }))
  return merged
}

export function subscribeFocusSoundPreferences(
  listener: (preferences: FocusSoundPreferences) => void,
) {
  const onChange = (event: Event) => {
    const custom = event as CustomEvent<FocusSoundPreferences | undefined>
    listener(normalizePreferences(custom.detail))
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => window.removeEventListener(CHANGE_EVENT, onChange)
}
