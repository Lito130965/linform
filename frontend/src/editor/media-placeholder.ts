/**
 * Canvas placeholders for images whose src is a Jinja expression.
 *
 * `<img src="{{ order_id | qr }}">` cannot load in the editor — the browser
 * tries to fetch the literal "{{ … }}" and shows a broken-image icon. So in
 * the canvas the real src is parked on `data-lf-src` and the visible src is
 * swapped for a self-describing SVG placeholder sized to the same footprint;
 * export puts the real src back (see export-body.ts). The true value never
 * changes — only what the canvas shows.
 */

const LF_SRC = 'data-lf-src'

function labelFor(src: string): string {
  const m = /\{\{\s*([\s\S]+?)\s*\}\}/.exec(src)
  const inner = m?.[1] ?? ''
  const value = inner.split('|')[0].trim()
  if (/\|\s*qr\b/.test(inner)) return `QR · ${value}`
  if (/\|\s*barcode\b/.test(inner)) return `Barcode · ${value}`
  return `Image · ${value}`
}

/** Aspect ratio hints so the placeholder occupies a realistic footprint when
 * only width is set: QR is square, a barcode is wide and short. */
function aspect(src: string): { w: number; h: number } {
  const m = /\{\{\s*([\s\S]+?)\s*\}\}/.exec(src)
  const inner = m?.[1] ?? ''
  if (/\|\s*qr\b/.test(inner)) return { w: 100, h: 100 }
  if (/\|\s*barcode\b/.test(inner)) return { w: 300, h: 96 }
  return { w: 200, h: 120 }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Data-URI SVG: a dashed frame with the label centred, at the given ratio. */
export function imagePlaceholder(src: string): string {
  const { w, h } = aspect(src)
  const label = esc(labelFor(src))
  const fontSize = Math.round(h / 7)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="rgba(79,140,255,0.08)" ` +
    `stroke="#4f8cff" stroke-width="1.5" stroke-dasharray="5 3"/>` +
    `<text x="50%" y="50%" fill="#4f8cff" font-family="sans-serif" font-size="${fontSize}" ` +
    `text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

/** True for an <img> whose src is a Jinja expression (won't load as a URL). */
export function isJinjaImage(img: Element): boolean {
  const src = img.getAttribute('src') ?? ''
  return img.tagName === 'IMG' && src.includes('{{')
}

/** Swap a Jinja src for its placeholder, remembering the real value. */
export function showPlaceholder(img: Element): void {
  const src = img.getAttribute('src') ?? ''
  if (img.hasAttribute(LF_SRC)) return
  img.setAttribute(LF_SRC, src)
  img.setAttribute('src', imagePlaceholder(src))
}

/** Restore the real src on a clone; used by exportBody. */
export function restoreRealSrc(img: Element): void {
  const real = img.getAttribute(LF_SRC)
  if (real === null) return
  img.setAttribute('src', real)
  img.removeAttribute(LF_SRC)
}

export const LF_SRC_ATTR = LF_SRC
