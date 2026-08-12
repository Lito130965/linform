/** Which nodes the editor lets you select, and what they are.
 *
 * Selection is structural: blocks, table parts, images, chips. Plain text is
 * not selectable as a node — it is edited in place through contenteditable.
 * The kind drives which toolbar actions make sense for the node.
 */

export type NodeKind =
  | 'chip'
  | 'counter'
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
])

// THEAD, TBODY and TFOOT are deliberately absent. A table section is not
// something anyone means to select: it usually is not in the author's markup at
// all — the parser inserts a <tbody> whether or not one was written — it has
// nothing to style in a print form, and it cannot hold a block (see
// placement.ts). As a selectable node it only ever appeared as a nameless
// "Block" between the table and its rows, adding a level to walk through on the
// way to something real.

/** Classes the page-number preset writes. Recognised by class rather than by a
 * marker attribute: the class is already in the template — the stylesheet rule
 * that fills the span needs it — so nothing editor-shaped has to be added and
 * stripped, and the atom survives a round trip through Code mode untouched. */
export const COUNTER_SELECTOR = '.lf-page-no, .lf-page-count'

export function kindOf(el: Element): NodeKind | null {
  // Canvas-only pagination spacers are never selectable.
  if (el.hasAttribute('data-lf-spacer')) return null
  // A page counter is one thing: it prints a number nobody types, and there is
  // nothing inside it to put a caret in.
  if (el.matches(COUNTER_SELECTOR)) return 'counter'
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
  counter: 'Page counter',
  raw: 'Jinja (locked)',
  loop: 'Repeating',
  conditional: 'Conditional',
  image: 'Image',
  cell: 'Cell',
  row: 'Row',
  table: 'Table',
  block: 'Block',
}
