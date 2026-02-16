type HslColor = {
  h: number
  s: number
  l: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeHexColor(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(hex)) return null
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  return `#${hex}`
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex)
  if (!normalized) return null
  const raw = normalized.slice(1)
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  }
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const red = r / 255
  const green = g / 255
  const blue = b / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6
    else if (max === green) h = (blue - red) / delta + 2
    else h = (red - green) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  return { h, s: s * 100, l: l * 100 }
}

function hslToRgb(h: number, s: number, l: number) {
  const sat = clamp(s, 0, 100) / 100
  const light = clamp(l, 0, 100) / 100
  const chroma = (1 - Math.abs(2 * light - 1)) * sat
  const sector = h / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))

  let red = 0
  let green = 0
  let blue = 0

  if (sector >= 0 && sector < 1) [red, green, blue] = [chroma, x, 0]
  else if (sector >= 1 && sector < 2) [red, green, blue] = [x, chroma, 0]
  else if (sector >= 2 && sector < 3) [red, green, blue] = [0, chroma, x]
  else if (sector >= 3 && sector < 4) [red, green, blue] = [0, x, chroma]
  else if (sector >= 4 && sector < 5) [red, green, blue] = [x, 0, chroma]
  else [red, green, blue] = [chroma, 0, x]

  const m = light - chroma / 2
  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255),
  }
}

function toHex(value: number) {
  return value.toString(16).padStart(2, '0')
}

function hslToHex(color: HslColor) {
  const rgb = hslToRgb(color.h, color.s, color.l)
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

function toTriplet(color: HslColor) {
  return `${Math.round(color.h)} ${Math.round(color.s)}% ${Math.round(color.l)}%`
}

function shiftLightness(color: HslColor, offset: number) {
  return { ...color, l: clamp(color.l + offset, 8, 95) }
}

function shiftSaturation(color: HslColor, offset: number) {
  return { ...color, s: clamp(color.s + offset, 14, 94) }
}

export function generateAccentShades(hex: string) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null

  const base = rgbToHsl(rgb.r, rgb.g, rgb.b)
  const normalizedBase = {
    h: base.h,
    s: clamp(base.s, 32, 90),
    l: clamp(base.l, 32, 66),
  }

  const light = shiftLightness(normalizedBase, 16)
  const soft = shiftLightness(shiftSaturation(normalizedBase, -14), 26)
  const dark = shiftLightness(normalizedBase, -14)
  const deeper = shiftLightness(normalizedBase, -24)

  return {
    css: {
      primary: toTriplet(normalizedBase),
      ring: toTriplet(shiftSaturation(normalizedBase, 8)),
      chart1: toTriplet(normalizedBase),
      chart2: toTriplet(light),
      chart3: toTriplet(dark),
      cardHover: toTriplet(soft),
    },
    preview: {
      base: hslToHex(normalizedBase),
      light: hslToHex(light),
      soft: hslToHex(soft),
      dark: hslToHex(dark),
      deeper: hslToHex(deeper),
    },
  }
}
