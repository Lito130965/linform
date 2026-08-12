/**
 * Where a block can actually go, relative to the element somebody aimed at.
 *
 * "Before" and "after" are enough almost everywhere and wrong in a table. After
 * a `<td>` means another child of the `<tr>`, and a paragraph is not something a
 * row can hold: the parser lifts it straight back out, so the block a person
 * dropped into a cell appears beside the whole table instead. The same applies
 * to a preset inserted while a cell is selected — which is how this was found.
 *
 * So a cell is not a thing to put something *next to*, it is a thing to put
 * something *in*. Rows and table sections cannot hold a block at all, and the
 * nearest place that can is outside the table.
 *
 * The same is true of every element that holds blocks — a section, a header, a
 * div somebody is using as a card. Being able to put a block INSIDE one, and to
 * drag it back out, is the difference between a document that is a flat list of
 * paragraphs and one that has structure. A drag says which it means by where it
 * hovers: near an edge is beside, the middle is inside.
 *
 * Pure, and separate from the canvas, so the rule is stated once and tested
 * without a browser — both the insert path and the drag path read it.
 */

export type Where = 'before' | 'after' | 'inside'

export interface Placement {
  el: Element
  where: Where
}

const ROW_PARTS = new Set(['TR', 'THEAD', 'TBODY', 'TFOOT', 'COLGROUP', 'COL', 'CAPTION'])

/** Elements that hold other blocks — the ones a thing can be put *into*.
 *
 * A paragraph or a heading is not here: it holds text, and a block dropped in
 * one would be lifted straight back out by the parser. A table is not here
 * either — its insides are rows, and only a cell can hold a block. */
const CONTAINERS = new Set([
  'DIV', 'SECTION', 'HEADER', 'FOOTER', 'ARTICLE', 'ASIDE', 'MAIN',
  'BLOCKQUOTE', 'LI', 'TD', 'TH',
])

export function isContainer(el: Element): boolean {
  return CONTAINERS.has(el.tagName)
}

/** How much of a container's height, top and bottom, means "next to it" rather
 * than "in it". Wide enough to hit without care, narrow enough that the middle
 * of a big section is comfortably inside. */
const EDGE_BAND = 0.3

/**
 * Where a drag hovering at `y` over `target` wants to drop.
 *
 * Three bands rather than two: near an edge is before or after, as it always
 * was, and the middle of something that can hold blocks means inside it. That
 * is what makes it possible to put a block INTO a section — and, by dropping
 * on the edge of the section instead, to take one back out.
 *
 * @param y pointer position in the same coordinates as the rectangle
 */
export function dropPlacement(
  target: Element,
  y: number,
  rect: { top: number; height: number },
): Placement {
  const offset = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
  if (CELLS.has(target.tagName)) return { el: target, where: 'inside' }
  if (isContainer(target) && offset > EDGE_BAND && offset < 1 - EDGE_BAND) {
    return { el: target, where: 'inside' }
  }
  // The edge of a container is a real place to be — beside it, at the level it
  // is on. That is the only way a block gets back OUT of one, so it cannot
  // defer to the insert rule, which always answers "in".
  return beside(target, offset < 0.5 ? 'before' : 'after')
}

/**
 * @param target what the pointer or the selection landed on
 * @param preferred which side the caller wanted, when a side is possible
 */
/** Beside the target — or, where that is impossible, beside the nearest thing
 * that has an outside. Nothing block-level can sit between table rows. */
function beside(target: Element, preferred: 'before' | 'after'): Placement {
  if (ROW_PARTS.has(target.tagName)) {
    const table = target.closest('table')
    return table ? { el: table, where: preferred } : { el: target, where: preferred }
  }
  return { el: target, where: preferred }
}

/** A cell has no outside a block can occupy: between two cells is not a place.
 * Every route therefore puts a block INTO one. */
const CELLS = new Set(['TD', 'TH'])

export function placementFor(target: Element, preferred: 'before' | 'after'): Placement {
  // Anything that holds blocks is a thing to put something IN. Selecting a
  // section and asking for a paragraph means one in the section; a paragraph is
  // not a container, so there the answer is still "next to it".
  if (isContainer(target)) return { el: target, where: 'inside' }
  return beside(target, preferred)
}

/** Put `node` where the placement says, without asking the caller to remember
 * which of three methods that is. */
export function place(node: Node, at: Placement): void {
  if (at.where === 'inside') at.el.append(node)
  else if (at.where === 'before') at.el.before(node)
  else at.el.after(node)
}
