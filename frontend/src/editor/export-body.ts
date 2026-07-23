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

const CANVAS_ONLY_ATTRS = ['contenteditable', 'spellcheck', 'draggable', 'data-lf-selected']

export function prepareBody(body: HTMLElement): void {
  body.setAttribute('contenteditable', 'true')
  body.setAttribute('spellcheck', 'false')
  // Chips are atomic: the caret must never enter one and split the expression.
  for (const chip of Array.from(body.querySelectorAll('[data-jinja-expr]'))) {
    chip.setAttribute('contenteditable', 'false')
  }
  // Native image dragging fights the selection model.
  for (const img of Array.from(body.querySelectorAll('img'))) {
    img.setAttribute('draggable', 'false')
  }
}

/** A newly inserted fragment gets the same affordances as the initial mount. */
export function prepareFragment(el: Element): void {
  if (el.hasAttribute('data-jinja-expr')) el.setAttribute('contenteditable', 'false')
  for (const chip of Array.from(el.querySelectorAll('[data-jinja-expr]'))) {
    chip.setAttribute('contenteditable', 'false')
  }
  for (const img of Array.from(el.querySelectorAll('img'))) {
    img.setAttribute('draggable', 'false')
  }
}

export function exportBody(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of CANVAS_ONLY_ATTRS) el.removeAttribute(attr)
  }
  return clone.innerHTML
}
