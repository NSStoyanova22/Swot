import { useEffect, useState } from 'react'

import {
  getFocusSoundPreferences,
  setFocusSoundPreferences,
  subscribeFocusSoundPreferences,
  type FocusSoundPreferences,
} from '@/lib/focus-sound'

export function useFocusSoundPreferences() {
  const [preferences, setPreferences] = useState<FocusSoundPreferences>(() => getFocusSoundPreferences())

  useEffect(() => {
    return subscribeFocusSoundPreferences((next) => setPreferences(next))
  }, [])

  const updatePreferences = (next: Partial<FocusSoundPreferences>) => {
    const value = setFocusSoundPreferences(next)
    setPreferences(value)
    return value
  }

  return {
    preferences,
    updatePreferences,
  }
}
