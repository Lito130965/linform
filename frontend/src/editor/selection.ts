/** Which nodes the editor lets you select, and what they are.
 *
 * Selection is structural: blocks, table parts, images, chips. Plain text is
 * not selectable as a node — it is edited in place through contenteditable.
 * The kind drives which toolbar actions make sense for the node.
 */

export type NodeKind =
  | 'chip'
  | 'raw'
  | 'loop'
  | 'conditional'
  | 'image'
  | 'cell'
  | 'row'
  | 'table'
  | 'block'

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'DIV',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'HR',
  'SECTION',
  'HEADER',
  'FOOTER',
  'THEAD',
  'TBODY',
  'TFOOT',
])

export function kindOf(el: Element): NodeKind | null {
  // Jinja marks outrank the tag: a repeating <tr> is first of all a loop.
  if (el.hasAttribute('data-jinja-expr')) return 'chip'
  if (el.hasAttribute('data-jinja-raw')) return 'raw'
  if (el.hasAttribute('data-jinja-for')) return 'loop'
  if (el.hasAttribute('data-jinja-if')) return 'conditional'
  switch (el.tagName) {
    case 'IMG':
      return 'image'
    case 'TD':
    case 'TH':
      return 'cell'
    case 'TR':
      return 'row'
    case 'TABLE':
      return 'table'
    default:
      return BLOCK_TAGS.has(el.tagName) ? 'block' : null
  }
}

/** Nearest selectable element from a click target, never the root itself. */
export function findSelectable(start: Element | null, root: Element): Element | null {
  let el = start
  while (el && el !== root) {
    if (kindOf(el)) return el
    el = el.parentElement
  }
  return null
}

/** The next selectable ancestor — the toolbar's "select parent". */
export function parentSelectable(el: Element, root: Element): Element | null {
  return findSelectable(el.parentElement, root)
}

export const KIND_LABEL: Record<NodeKind, string> = {
  chip: 'Placeholder',
  raw: 'Jinja (locked)',
  loop: 'Repeating',
  conditional: 'Conditional',
  image: 'Image',
  cell: 'Cell',
  row: 'Row',
  table: 'Table',
  block: 'Block',
}
