/**
 * A colour the props palettes edit: a 6-digit hex plus an opacity percent, the
 * two things the UI exposes (a native picker gives hex, a number gives alpha).
 *
 * It serialises two ways because the two consumers differ: CSS properties take
 * `rgba(…)`, which every renderer honours; the qr/barcode filters take hex,
 * including 8-digit `#rrggbbaa`, which is what segno accepts. parse() reads
 * back whatever either side stored.
 */

export interface Colour {
  /** '#rrggbb' */
  hex: string
  /** 0–100 */
  opacity: number
}

export const BLACK: Colour = { hex: '#000000', opacity: 100 }

export function parse(value: string): Colour {
  const v = value.trim()
  if (!v) return BLACK

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v)
  if (rgba) {
    return {
      hex: '#' + [rgba[1], rgba[2], rgba[3]].map((n) => clampHex(n)).join(''),
      opacity: rgba[4] === undefined ? 100 : Math.round(parseFloat(rgba[4]) * 100),
    }
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { hex: '#' + h.slice(0, 6).toLowerCase(), opacity: Math.round(alpha * 100) }
  }

  return BLACK
}

function clampHex(n: string): string {
  return Math.max(0, Math.min(255, parseInt(n, 10)))
    .toString(16)
    .padStart(2, '0')
}

/** For a CSS property value. */
export function toCss(c: Colour): string {
  const { r, g, b } = rgb(c.hex)
  return `rgba(${r}, ${g}, ${b}, ${round2(c.opacity / 100)})`
}

/** For a qr/barcode filter argument: 6-digit at full opacity, else 8-digit. */
export function toHex(c: Colour): string {
  if (c.opacity >= 100) return c.hex
  const a = Math.round((c.opacity / 100) * 255)
    .toString(16)
    .padStart(2, '0')
  return c.hex + a
}

function rgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
