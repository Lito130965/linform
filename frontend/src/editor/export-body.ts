/** Mount-time affordances and their exact removal at export.
 *
 * The spike proved innerHTML round-trips faithfully — but only if the editor
 * strips precisely what it added and nothing more. Everything the canvas puts
 * on the live DOM is listed here, and export removes exactly this list, so
 * the two functions are each other's inverse by construction.
 *
 * contenteditable / draggable / spellcheck are stripped wholesale rather than
 * tracked per-node: a *print* template carrying its own contenteditable would
 * be meaningless, so ownership of these attributes inside the canvas is ours.
 */

import { LF_SRC_ATTR, isJinjaImage, restoreRealSrc, showPlaceholder } from './media-placeholder'

const CANVAS_ONLY_ATTRS = ['contenteditable', 'spellcheck', 'draggable', 'data-lf-selected']

// Placeholder chips and inert raw chips are both atomic: the caret must never
// enter one and split the expression or the preserved source.
const CHIP_SELECTOR = '[data-jinja-expr], [data-jinja-raw]'

function affordImages(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    img.setAttribute('draggable', 'false') // native drag fights the selection model
    if (isJinjaImage(img)) showPlaceholder(img) // qr/barcode: box, not a broken icon
  }
}

export function prepareBody(body: HTMLElement): void {
  body.setAttribute('contenteditable', 'true')
  body.setAttribute('spellcheck', 'false')
  for (const chip of Array.from(body.querySelectorAll(CHIP_SELECTOR))) {
    chip.setAttribute('contenteditable', 'false')
  }
  affordImages(body)
}

/** A newly inserted fragment gets the same affordances as the initial mount. */
export function prepareFragment(el: Element): void {
  if (el.matches(CHIP_SELECTOR)) el.setAttribute('contenteditable', 'false')
  for (const chip of Array.from(el.querySelectorAll(CHIP_SELECTOR))) {
    chip.setAttribute('contenteditable', 'false')
  }
  if (isJinjaImage(el)) showPlaceholder(el)
  affordImages(el)
}

export function exportBody(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    // Real qr/barcode src comes back before the canvas-only attr is dropped.
    if (el.hasAttribute(LF_SRC_ATTR)) restoreRealSrc(el)
    for (const attr of CANVAS_ONLY_ATTRS) el.removeAttribute(attr)
  }
  return clone.innerHTML
}
