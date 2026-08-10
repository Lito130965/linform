/**
 * Merging and splitting table cells.
 *
 * A print form is mostly a table, and the shape of one is mostly made of merges:
 * a title spanning every column, a total spanning all but the last, a label that
 * covers two rows. Without them the only way to a real form's layout is Code.
 *
 * `colspan`/`rowspan` are attributes, not styles, so this is DOM surgery: the
 * cells a merge swallows have to be removed, and a split has to put them back.
 * Both are ordinary markup afterwards — nothing here needs the canvas to
 * remember anything.
 *
 * Pure DOM, no layout: testable in jsdom.
 */

const CELL = 'td, th'

function span(cell: Element, attribute: 'colspan' | 'rowspan'): number {
  const raw = Number(cell.getAttribute(attribute) ?? '1')
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
}

function setSpan(cell: Element, attribute: 'colspan' | 'rowspan', value: number): void {
  if (value <= 1) cell.removeAttribute(attribute)
  else cell.setAttribute(attribute, String(value))
}

/** Cells of the row, in order. */
function cellsOf(row: Element): Element[] {
  return Array.from(row.children).filter((el) => el.matches(CELL))
}

/** The row a cell is in, and the rows after it in the same table section. */
function rowsFrom(cell: Element): { row: Element; following: Element[] } | null {
  const row = cell.closest('tr')
  const section = row?.parentElement
  if (!row || !section) return null
  const rows = Array.from(section.children).filter((el) => el.tagName === 'TR')
  const index = rows.indexOf(row)
  return { row, following: rows.slice(index + 1) }
}

/** Is there a cell to the right to merge with? */
export function canMergeRight(cell: Element): boolean {
  const next = cell.nextElementSibling
  return !!next && next.matches(CELL) && span(cell, 'rowspan') === span(next, 'rowspan')
}

/**
 * Take the next cell into this one.
 *
 * Its content comes along rather than being thrown away: somebody merging two
 * cells that both say something meant to keep both, and losing the second
 * silently is the kind of thing that is only noticed after saving.
 */
export function mergeRight(cell: Element): void {
  const next = cell.nextElementSibling
  if (!next || !canMergeRight(cell)) return
  const text = (next.textContent ?? '').trim()
  if (text) {
    while (next.firstChild) cell.append(next.firstChild)
  }
  setSpan(cell, 'colspan', span(cell, 'colspan') + span(next, 'colspan'))
  next.remove()
}

/** Is there a row below whose cells this one can swallow? */
export function canMergeDown(cell: Element): boolean {
  return cellsBelow(cell).length > 0
}

/**
 * The cells directly under this one — all of them.
 *
 * A merged cell is wider than one column, so what sits beneath it is usually
 * several cells rather than one. Requiring a single cell of equal width made
 * merging right and then down impossible, which is the shape of half the
 * headings on a real form.
 *
 * Found by counting columns rather than children: a row above may already span
 * several, so the nth child is not the nth column. Empty when the row below
 * does not line up — a cell there spanning past the edge of this one has no
 * answer that is not a guess.
 */
function cellsBelow(cell: Element): Element[] {
  const context = rowsFrom(cell)
  if (!context) return []
  const target = columnOf(cell)
  const width = span(cell, 'colspan')
  const nextRow = context.following[span(cell, 'rowspan') - 1]
  if (!nextRow) return []

  const found: Element[] = []
  let column = 0
  for (const candidate of cellsOf(nextRow)) {
    const candidateWidth = span(candidate, 'colspan')
    if (column >= target && column + candidateWidth <= target + width) found.push(candidate)
    else if (column < target + width && column + candidateWidth > target) return [] // straddles
    column += candidateWidth
  }
  const covered = found.reduce((total, one) => total + span(one, 'colspan'), 0)
  if (covered !== width) return []
  // They must also be the same height, or the block would come out ragged.
  const heights = new Set(found.map((one) => span(one, 'rowspan')))
  return heights.size === 1 ? found : []
}

/** Which column a cell starts in, counting the spans of the cells before it. */
export function columnOf(cell: Element): number {
  let column = 0
  for (const sibling of cellsOf(cell.parentElement!)) {
    if (sibling === cell) return column
    column += span(sibling, 'colspan')
  }
  return column
}

export function mergeDown(cell: Element): void {
  const below = cellsBelow(cell)
  if (below.length === 0) return
  for (const one of below) {
    if ((one.textContent ?? '').trim()) {
      while (one.firstChild) cell.append(one.firstChild)
    }
  }
  setSpan(cell, 'rowspan', span(cell, 'rowspan') + span(below[0], 'rowspan'))
  for (const one of below) one.remove()
}

export function isMerged(cell: Element): boolean {
  return span(cell, 'colspan') > 1 || span(cell, 'rowspan') > 1
}

/**
 * Undo a merge: the cell shrinks back to one column and one row, and the cells
 * it swallowed reappear empty beside and below it.
 */
export function splitCell(cell: Element): void {
  const columns = span(cell, 'colspan')
  const rows = span(cell, 'rowspan')
  if (columns === 1 && rows === 1) return
  const doc = cell.ownerDocument
  const tag = cell.tagName.toLowerCase()

  setSpan(cell, 'colspan', 1)
  setSpan(cell, 'rowspan', 1)

  for (let i = 1; i < columns; i++) {
    const fresh = doc.createElement(tag)
    fresh.innerHTML = '&nbsp;'
    cell.after(fresh)
  }

  const context = rowsFrom(cell)
  if (!context) return
  const target = columnOf(cell)
  for (let r = 1; r < rows; r++) {
    const row = context.following[r - 1]
    if (!row) break
    // Put them back in the column the merge covered, not at the end of the row.
    let column = 0
    let before: Element | null = null
    for (const candidate of cellsOf(row)) {
      if (column >= target) {
        before = candidate
        break
      }
      column += span(candidate, 'colspan')
    }
    for (let i = 0; i < columns; i++) {
      const fresh = doc.createElement(tag)
      fresh.innerHTML = '&nbsp;'
      if (before) row.insertBefore(fresh, before)
      else row.append(fresh)
    }
  }
}
