/**
 * Lengths for a print form: reading them, writing them, and deciding what a
 * person meant by what they typed.
 *
 * Two rules shape all of it.
 *
 * **Millimetres are the default unit.** This is paper. Nobody sets a margin on
 * a form in pixels, and a bare `12` typed into a spacing box means 12 mm — the
 * unit a person would have written on a printout. Every other CSS unit is still
 * accepted verbatim, because a template may already be written in them.
 *
 * **An empty box clears the property.** It does not write `0`. Clearing means
 * "go back to whatever the stylesheet says", which is a different statement
 * from "zero", and a form's stylesheet usually has an opinion worth returning
 * to.
 *
 * Pure: no DOM, so the parsing and the arithmetic are testable without a layout
 * engine.
 */

/** CSS reference pixels per millimetre — the ratio the browser itself uses when
 * it resolves `mm`, and the same one the page geometry is built on. */
export const PX_PER_MM = 96 / 25.4

export type BoxSide = 'top' | 'right' | 'bottom' | 'left'

export const SIDES: BoxSide[] = ['top', 'right', 'bottom', 'left']

/** What a typed value asks for. Three outcomes, because "clear it" and "that is
 * not a length" must not both arrive as an empty string — one is an edit and
 * the other is a mistake that should leave the document alone. */
export type LengthInput =
  | { kind: 'clear' }
  | { kind: 'set'; value: string }
  | { kind: 'invalid' }

const BARE_NUMBER = /^-?\d+(\.\d+)?$/
const WITH_UNIT = /^-?\d+(\.\d+)?\s*(mm|cm|in|px|pt|pc|%|em|rem|ex|ch|vw|vh)$/

export function readLengthInput(typed: string): LengthInput {
  const text = typed.trim().toLowerCase()
  if (!text) return { kind: 'clear' }
  if (text === 'auto') return { kind: 'set', value: 'auto' }
  if (BARE_NUMBER.test(text)) return { kind: 'set', value: `${text}mm` }
  if (WITH_UNIT.test(text)) return { kind: 'set', value: text.replace(/\s+/g, '') }
  return { kind: 'invalid' }
}

/** Millimetres, rounded to a tenth — finer than a printer resolves and finer
 * than anyone sets by hand, so the extra digits are noise in a small box. */
export function pxToMm(px: number): number {
  return Math.round((px / PX_PER_MM) * 10) / 10
}

/** A computed pixel value as the millimetre hint shown in an empty box. Returns
 * an empty string for values that are not a length (`auto`, percentages that
 * did not resolve), since a hint nobody can act on is worse than none. */
export function mmHint(computed: string): string {
  const px = parseFloat(computed)
  if (!Number.isFinite(px)) return ''
  return `${pxToMm(px)}`
}

/** How a value got there. `set` means this element carries it inline — the box
 * shows it as a real value the user can clear; `inherited` means the stylesheet
 * decided, and the box shows it as a hint instead. The distinction is the whole
 * reason a person can tell "I set 0" from "it happens to be 0". */
export type Provenance = 'set' | 'inherited'

export function provenanceOf(inline: string): Provenance {
  return inline.trim() ? 'set' : 'inherited'
}

/** The value to show in a box: what this element carries, in millimetres when
 * it is a plain length, and verbatim otherwise (`auto`, `50%`, `calc(...)`) —
 * rewriting somebody's `50%` as millimetres would be a silent edit. */
export function displayValue(inline: string): string {
  const text = inline.trim()
  if (!text) return ''
  const px = /^-?\d+(\.\d+)?px$/.test(text) ? parseFloat(text) : NaN
  if (Number.isFinite(px)) return `${pxToMm(px)}`
  const mm = /^(-?\d+(\.\d+)?)mm$/.exec(text)
  return mm ? mm[1] : text
}

/** The grid drawn while something is being dragged: a fine step to judge
 * alignment by and a coarser one to count by. Millimetres, because the ruler a
 * person imagines over a form is a millimetre ruler. */
export const GRID_MINOR_MM = 5
export const GRID_MAJOR_MM = 25
