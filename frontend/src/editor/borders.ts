/**
 * Borders on one element, per side.
 *
 * The only border control until now was the table's — all cells, outer only, or
 * none — which covers the two shapes a table usually wants and nothing else. A
 * printed form is full of the rest: a line under a signature, a box around a
 * note, a heavy rule above a total, one cell of a table ruled differently from
 * the others.
 *
 * Read and write the shorthand rather than the four longhands, because that is
 * what an author writing this by hand would put there and what they will read
 * afterwards. Sides that agree collapse to `border`; sides that differ are
 * written one by one.
 *
 * Pure style-object work, no layout: testable without a browser.
 */

import { setDeclarations } from './style-attr'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

export type BorderStyle = 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
export const BORDER_STYLES: BorderStyle[] = ['none', 'solid', 'dashed', 'dotted', 'double']

export interface Border {
  width: string
  style: BorderStyle
  colour: string
}

export const NO_BORDER: Border = { width: '1px', style: 'none', colour: '#000000' }

/** `1px solid #333` in any order, as CSS allows. */
export function parseBorder(value: string): Border {
  const text = value.trim()
  if (!text) return { ...NO_BORDER }
  const style = BORDER_STYLES.find((s) => new RegExp(`(^|\\s)${s}(\\s|$)`, 'i').test(text))
  const width = /(^|\s)(thin|medium|thick|[\d.]+(?:px|mm|cm|pt|in|em|rem))(\s|$)/i.exec(text)
  const colour = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b(?:black|white|grey|gray|red|blue|green)\b)/i.exec(
    text,
  )
  return {
    width: width ? width[2] : NO_BORDER.width,
    style: (style as BorderStyle) ?? (text === 'none' ? 'none' : 'solid'),
    colour: colour ? colour[1] : NO_BORDER.colour,
  }
}

export function borderToCss(border: Border): string {
  return border.style === 'none' ? 'none' : `${border.width} ${border.style} ${border.colour}`
}

/** What an element's four sides currently are, as the browser resolved them. */
export function readBorders(
  el: Element,
  view: Window,
): Record<Side, Border> {
  const computed = view.getComputedStyle(el)
  const out = {} as Record<Side, Border>
  for (const side of SIDES) {
    const style = computed.getPropertyValue(`border-${side}-style`) || 'none'
    out[side] = {
      width: computed.getPropertyValue(`border-${side}-width`) || '1px',
      style: (BORDER_STYLES.includes(style as BorderStyle) ? style : 'solid') as BorderStyle,
      colour: computed.getPropertyValue(`border-${side}-color`) || '#000000',
    }
  }
  return out
}

/** Are all four the same thing? Then the shorthand says it in one line. */
export function sameOnEverySide(borders: Record<Side, Border>): boolean {
  const [first, ...rest] = SIDES.map((side) => borderToCss(borders[side]))
  return rest.every((one) => one === first)
}

/**
 * Write the four sides onto an element's inline style.
 *
 * Every property this function owns is cleared in the same rewrite, because a
 * `border-top` left over from a previous edit would otherwise survive under a
 * shorthand written after it — the shorthand comes first in the declaration and
 * the longhand wins.
 */
export function applyBorders(el: HTMLElement, borders: Record<Side, Border>): void {
  const patch: Record<string, string | null> = {
    border: null,
    'border-style': null,
  }
  for (const side of SIDES) {
    patch[`border-${side}`] = null
    patch[`border-${side}-style`] = null
  }

  // Removing a border is written as a style rather than as `border: none`.
  // Both mean the same to a renderer and only one survives every CSSOM, and a
  // declaration that quietly fails to land is a border that quietly stays.
  if (sameOnEverySide(borders)) {
    if (borders.top.style === 'none') patch['border-style'] = 'none'
    else patch.border = borderToCss(borders.top)
  } else {
    for (const side of SIDES) {
      if (borders[side].style === 'none') patch[`border-${side}-style`] = 'none'
      else patch[`border-${side}`] = borderToCss(borders[side])
    }
  }
  // Through the attribute: a CSSOM write would rebuild it from what the parser
  // kept, and take `position: running(…)` off a header with it (style-attr.ts).
  setDeclarations(el, patch)
}
