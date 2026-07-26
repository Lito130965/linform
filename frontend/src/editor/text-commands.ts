/** Inline formatting as our own DOM commands.
 *
 * execCommand is deprecated and notoriously moody after programmatic
 * mutations, so the common paths are implemented directly: wrap the selected
 * range in a tag, or unwrap when it is already inside one. The one genuinely
 * hard case — a selection that PARTIALLY covers an existing formatted run —
 * is handled by extract-and-wrap, which may split formatting at the edges;
 * that is what every editor does.
 */

const TAGS = { bold: 'B', italic: 'I', underline: 'U' } as const
export type InlineFormat = keyof typeof TAGS

function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
}

/** Toggle bold/italic/underline over the current selection in `doc`. */
export function toggleInline(doc: Document, format: InlineFormat): void {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  const tag = TAGS[format]

  // Already formatted? The nearest same-tag ancestor of the selection.
  const anchor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  const wrapper = anchor?.closest(tag.toLowerCase())
  if (wrapper) {
    unwrap(wrapper)
    return
  }

  const el = doc.createElement(tag)
  try {
    // Clean path: the range does not cross element boundaries.
    range.surroundContents(el)
  } catch {
    // Partial overlap: take the contents out and wrap what came out.
    el.appendChild(range.extractContents())
    range.insertNode(el)
  }
  sel.removeAllRanges()
  const after = doc.createRange()
  after.selectNodeContents(el)
  sel.addRange(after)
}

/** Set text alignment on the nearest block that owns the selection/element. */
export function setAlign(target: Element, align: 'left' | 'center' | 'right' | 'justify'): void {
  const block = target.closest(
    'p, h1, h2, h3, h4, h5, h6, div, td, th, li, blockquote',
  ) as HTMLElement | null
  if (block) block.style.textAlign = align
}
