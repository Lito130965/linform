/**
 * Convert-existing: the plan's central authoring move — build a static example,
 * then mark it dynamic. These operate on the already-selected canvas node.
 *
 * "Make repeating" and "wrap conditional" are just the bridge's own marker
 * attributes (data-jinja-for / data-jinja-if), which round-trip to
 * {% for %}/{% if %} on export — so converting is a one-attribute DOM edit,
 * nothing the bridge has not already handled. Splitting a value into character
 * cells replaces the node's content and is built in the component, where
 * protect() is available.
 */

export function makeRepeating(el: Element, item: string, array: string): void {
  el.setAttribute('data-jinja-for', `${item.trim()} in ${array.trim()}`)
}

export function wrapConditional(el: Element, condition: string): void {
  el.setAttribute('data-jinja-if', condition.trim())
}

/** Best guess at the value already inside a node, to pre-fill a convert dialog:
 * a placeholder chip's expression, or the first {{ … }} in its text. */
export function existingValue(el: Element): string {
  const chip = el.matches('[data-jinja-expr]')
    ? el
    : el.querySelector('[data-jinja-expr]')
  if (chip) return chip.getAttribute('data-jinja-expr') ?? ''
  const m = /\{\{\s*([^}]+?)\s*\}\}/.exec(el.textContent ?? '')
  return m ? m[1].trim() : ''
}

/** Is the node already the kind of dynamic thing this convert would make it,
 * so the action can be hidden rather than doubly applied? */
export function isRepeating(el: Element): boolean {
  return el.hasAttribute('data-jinja-for')
}

export function isConditional(el: Element): boolean {
  return el.hasAttribute('data-jinja-if')
}
