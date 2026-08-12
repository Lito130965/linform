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

const CANVAS_ONLY_ATTRS = [
  'contenteditable',
  'spellcheck',
  'draggable',
  'data-lf-selected',
  'data-lf-anchor',
  'data-lf-pagebg',
  'data-lf-running',
  'data-lf-pagebreak',
  'data-lf-hidden',
]

// Placeholder chips and inert raw chips are both atomic: the caret must never
// enter one and split the expression or the preserved source.
const CHIP_SELECTOR = '[data-jinja-expr], [data-jinja-raw], .lf-page-no, .lf-page-count'

/** A dedicated page-break: an empty element whose only job is the break. It is
 * invisible in print, so the canvas badges it (via data-lf-pagebreak) to make
 * it clickable — then the toolbar's move/delete work on it like any block. */
function isPageBreakBlock(el: Element): boolean {
  const style = el.getAttribute('style') ?? ''
  if (!/(?:page-)?break-(?:after|before)\s*:\s*(always|page)/i.test(style)) return false
  return el.children.length === 0 && (el.textContent ?? '').trim() === ''
}

function affordBreaks(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (isPageBreakBlock(el)) el.setAttribute('data-lf-pagebreak', '')
  }
}

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
  affordBreaks(body)
}

/** A newly inserted fragment gets the same affordances as the initial mount. */
export function prepareFragment(el: Element): void {
  if (el.matches(CHIP_SELECTOR)) el.setAttribute('contenteditable', 'false')
  for (const chip of Array.from(el.querySelectorAll(CHIP_SELECTOR))) {
    chip.setAttribute('contenteditable', 'false')
  }
  if (isJinjaImage(el)) showPlaceholder(el)
  if (isPageBreakBlock(el)) el.setAttribute('data-lf-pagebreak', '')
  affordImages(el)
  affordBreaks(el)
}

export function exportBody(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement
  // Canvas-only pagination spacers never belong in the template.
  for (const spacer of Array.from(clone.querySelectorAll('[data-lf-spacer]'))) spacer.remove()
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    // Real qr/barcode src comes back before the canvas-only attr is dropped.
    if (el.hasAttribute(LF_SRC_ATTR)) restoreRealSrc(el)
    for (const attr of CANVAS_ONLY_ATTRS) el.removeAttribute(attr)
  }
  return clone.innerHTML
}
