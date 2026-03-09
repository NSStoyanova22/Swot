const CELEBRATION_COOLDOWN_KEY = 'swot-celebration-cooldowns-v1'

type CooldownMap = Record<string, number>

function readCooldownMap(): CooldownMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CELEBRATION_COOLDOWN_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CooldownMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCooldownMap(values: CooldownMap) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CELEBRATION_COOLDOWN_KEY, JSON.stringify(values))
}

export function getCelebrationCooldownLastAt(scope: string) {
  const map = readCooldownMap()
  const value = map[scope]
  return Number.isFinite(value) ? value : 0
}

export function canTriggerCelebrationCooldown(scope: string, cooldownHours: number) {
  const cooldownMs = Math.max(1, cooldownHours) * 60 * 60 * 1000
  const lastAt = getCelebrationCooldownLastAt(scope)
  if (!lastAt) return true
  return Date.now() - lastAt >= cooldownMs
}

export function markCelebrationCooldown(scope: string) {
  const map = readCooldownMap()
  map[scope] = Date.now()
  writeCooldownMap(map)
}

