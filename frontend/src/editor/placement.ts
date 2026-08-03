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
 * Pure, and separate from the canvas, so the rule is stated once and tested
 * without a browser — both the insert path and the drag path read it.
 */

export type Where = 'before' | 'after' | 'inside'

export interface Placement {
  el: Element
  where: Where
}

const CELLS = new Set(['TD', 'TH'])
const ROW_PARTS = new Set(['TR', 'THEAD', 'TBODY', 'TFOOT', 'COLGROUP', 'COL', 'CAPTION'])

/**
 * @param target what the pointer or the selection landed on
 * @param preferred which side the caller wanted, when a side is possible
 */
export function placementFor(target: Element, preferred: 'before' | 'after'): Placement {
  if (CELLS.has(target.tagName)) return { el: target, where: 'inside' }
  if (ROW_PARTS.has(target.tagName)) {
    // Nothing block-level can sit between rows. The table is the nearest thing
    // that has an outside.
    const table = target.closest('table')
    return table ? { el: table, where: preferred } : { el: target, where: preferred }
  }
  return { el: target, where: preferred }
}

/** Put `node` where the placement says, without asking the caller to remember
 * which of three methods that is. */
export function place(node: Node, at: Placement): void {
  if (at.where === 'inside') at.el.append(node)
  else if (at.where === 'before') at.el.before(node)
  else at.el.after(node)
}
