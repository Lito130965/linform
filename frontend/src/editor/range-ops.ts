/**
 * Where the caret is, and what may not be cut in half on the way there.
 *
 * Two rules the canvas keeps having to state, so they are stated once here.
 *
 * **Atomic nodes.** A placeholder chip and a locked raw chip are single things:
 * the attribute carries the Jinja expression and the visible text is only a
 * label. A range that ends halfway into one is a range that, when something
 * wraps or extracts it, splits the element — and the export reads the ATTRIBUTE
 * of each half, so one `{{ customer }}` silently becomes two. That is how
 * pressing Bold over a sentence containing a field used to add a second copy of
 * the field to the template.
 *
 * So boundaries are moved out of atomic nodes before any range operation, and
 * they move OUTWARDS: a drag that ran into a chip covered it on screen, and the
 * only two honest answers are all of it or none of it. All of it is what was
 * highlighted. A boundary that merely touched an edge covered nothing, and
 * stays where it is.
 *
 * **Inline goes where you are.** A field, a QR code, a run of character cells
 * belong in the sentence the caret is in. A table or a heading does not — the
 * parser would lift it straight back out of the paragraph — so block content
 * keeps landing beside the selected block. Deciding this by what is being
 * inserted, rather than by which panel asked, means the answer is the same
 * wherever the request came from.
 *
 * Pure DOM, no layout, no React: testable in jsdom.
 */

export const ATOMIC_SELECTOR = '[data-jinja-expr], [data-jinja-raw]'

/** Elements that can legally sit inside a line of text. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM',
  'I', 'IMG', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG',
  'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
])

export function isInline(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  return INLINE_TAGS.has((node as Element).tagName)
}

/** Every one of them, and at least one — an empty insert has nowhere to be. */
export function allInline(nodes: readonly Node[]): boolean {
  return nodes.length > 0 && nodes.every(isInline)
}

function atomicAt(node: Node | null): Element | null {
  if (!node) return null
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el ? el.closest(ATOMIC_SELECTOR) : null
}

/** Is the boundary at the very start of `node` — nothing of it before? */
function atStartOf(node: Element, container: Node, offset: number): boolean {
  const probe = node.ownerDocument.createRange()
  probe.selectNodeContents(node)
  probe.setEnd(container, offset)
  return probe.toString().length === 0
}

/**
 * Move both ends of `range` out of any atomic node they are inside, outwards.
 *
 * A start inside a chip goes before it: everything from there on was
 * highlighted, and the chip cannot be entered halfway. An end inside a chip
 * goes after it for the same reason — unless it sits at the very front, where
 * none of the chip was covered and there is nothing to take.
 *
 * A range that lay entirely within one chip therefore comes back as exactly
 * that chip, which is a thing that can be wrapped whole and not a thing that
 * can be split. Mutates and returns the range it was given — callers pass a
 * clone when they need the original.
 */
export function clampOutOfAtomic(range: Range): Range {
  const startAtomic = atomicAt(range.startContainer)
  if (startAtomic) range.setStartBefore(startAtomic)

  const endAtomic = atomicAt(range.endContainer)
  if (endAtomic) {
    if (atStartOf(endAtomic, range.endContainer, range.endOffset)) {
      range.setEndBefore(endAtomic)
    } else {
      range.setEndAfter(endAtomic)
    }
  }
  return range
}

/** The live caret or selection inside `body`, or null when it is elsewhere —
 * in another element of the page, or never placed at all. */
export function caretRangeIn(body: HTMLElement): Range | null {
  const selection = body.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return body.contains(range.startContainer) ? range : null
}

/** Put the caret immediately after `node`, so typing carries on from what was
 * just inserted rather than from wherever the mouse last was. */
export function caretAfter(node: Node): void {
  const doc = node.ownerDocument
  const selection = doc?.getSelection()
  if (!doc || !selection) return
  const range = doc.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}
