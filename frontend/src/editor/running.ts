/**
 * Headers and footers, drawn where they print.
 *
 * `position: running(name)` takes an element out of the flow and parks it in a
 * `@page` margin box — `@bottom-left { content: element(lf-footer) }`. No
 * browser implements it, so in the canvas the element stayed exactly where it
 * was written: a footer authored at the top of the body appeared at the top of
 * the document, and the margin band showed a grey "⟨element lf-footer⟩" that
 * could not be clicked, edited or found in the structure.
 *
 * The canvas knows both halves — which box pulls which element, and how wide
 * the margins are — so it can put the element in the band it belongs to. It is
 * the same element, still in the document, still editable: "Confidential ·
 * {{ company }}" sits at the bottom left of the page, which is where it prints
 * and where somebody goes looking for it.
 *
 * Offsets from the edge are the element's own margins, in millimetres. They
 * mean the same thing in print — a margin box positions its content by the
 * content's own box — so dragging one here writes something the renderer obeys
 * rather than something the canvas privately remembers.
 *
 * Only the first page is drawn. The canvas is one continuous strip, and a
 * header repeated down it would be a decoration nobody asked for; the badge
 * says what it is instead.
 */

import { parseMarginBoxes, runningSelectors } from './furniture'

export interface Slot {
  edge: 'top' | 'bottom'
  place: 'left' | 'center' | 'right'
}

/** Attribute the canvas puts on a running element: `top-center`, `bottom-left`. */
export const RUNNING_ATTR = 'data-lf-running'

/** Which margin box pulls each running name. */
export function slotsByName(css: string): Map<string, Slot> {
  const out = new Map<string, Slot>()
  for (const box of parseMarginBoxes(css)) {
    if (box.runningName) out.set(box.runningName, { edge: box.edge, place: box.slot })
  }
  return out
}

/** The running name an element declares, from its own style or from a rule. */
export function runningNameOf(el: Element, css: string): string | null {
  const inline = /position:\s*running\(\s*([\w-]+)\s*\)/i.exec(el.getAttribute('style') ?? '')
  if (inline) return inline[1]
  for (const { selector, name } of runningSelectors(css)) {
    try {
      if (el.matches(selector)) return name
    } catch {
      // A selector the browser will not parse is not one to crash over.
    }
  }
  return null
}

/**
 * Tag every running element with the box it belongs to.
 *
 * Returns how many were placed, so the caller can tell the difference between
 * "this document has no furniture" and "its furniture is not pulled by any
 * margin box" — the second being an authoring mistake worth showing.
 */
export function markRunning(body: HTMLElement, css: string): number {
  const slots = slotsByName(css)
  let placed = 0
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
    const name = runningNameOf(el, css)
    if (!name) {
      if (el.hasAttribute(RUNNING_ATTR)) el.removeAttribute(RUNNING_ATTR)
      continue
    }
    const slot = slots.get(name)
    // Declared running but pulled by nothing: it prints nowhere at all, which
    // is worth saying rather than quietly drawing it in the flow.
    const want = slot ? `${slot.edge}-${slot.place}` : 'unplaced'
    // Only when it differs. Setting an attribute to the value it already has
    // still raises a mutation record, and the canvas watches for those to
    // decide it has been edited — so an unconditional write here is a loop
    // between this and the observer that never settles.
    if (el.getAttribute(RUNNING_ATTR) !== want) el.setAttribute(RUNNING_ATTR, want)
    if (slot) placed++
  }
  return placed
}

export interface BandGeometry {
  /** @page margin-top in px. */
  top: number
  /** @page margin-bottom in px. */
  bottom: number
  /** Height of one page's content band, or null when the page has no height. */
  usable: number | null
}

/**
 * Canvas-only CSS placing the tagged elements in their bands.
 *
 * Coordinates are the body's, and the body IS the page area — so the top band
 * is at a negative offset and the bottom band starts one content height down.
 *
 * `align-content` rather than flex: a header is a line of prose, and flex would
 * turn every span in it into a separate item and eat the spaces between them.
 */
export function runningBoxCss(geometry: BandGeometry): string {
  const bottomTop =
    geometry.usable === null ? `bottom: ${-geometry.bottom}px;` : `top: ${geometry.usable}px;`
  return `
  [${RUNNING_ATTR}] {
    position: absolute;
    left: 0;
    right: 0;
    align-content: center;
    outline: 1px dashed rgba(181, 138, 42, 0.8);
    outline-offset: 2px;
  }
  [${RUNNING_ATTR}^="top-"] { top: ${-geometry.top}px; height: ${geometry.top}px; }
  [${RUNNING_ATTR}^="bottom-"] { ${bottomTop} height: ${geometry.bottom}px; }
  /* Not a page corner at all: left where it was written, and said so below. */
  [${RUNNING_ATTR}="unplaced"] { position: static; height: auto; }
  [${RUNNING_ATTR}$="-left"] { text-align: left; }
  [${RUNNING_ATTR}$="-center"] { text-align: center; }
  [${RUNNING_ATTR}$="-right"] { text-align: right; }
  /* The label floats: inside the band it would push the content it names. */
  [${RUNNING_ATTR}]::after {
    content: "repeats on every page";
    position: absolute;
    right: 0;
    top: -11px;
    font: 9px/1 system-ui, sans-serif;
    color: #8a6d1a;
    letter-spacing: 0.3px;
    pointer-events: none;
  }
  [${RUNNING_ATTR}="unplaced"]::after {
    content: "no margin box pulls this — it will not print";
    color: #c94f4f;
    position: static;
  }
`
}

/** Millimetres an element is offset from the edge of its band, as authored. */
export function offsetOf(el: HTMLElement): { x: string; y: string } {
  return { x: el.style.marginLeft || '0mm', y: el.style.marginTop || '0mm' }
}
