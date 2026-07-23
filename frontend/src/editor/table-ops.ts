/** Table structure commands as direct DOM operations.
 *
 * Ported from the GrapesJS cell tools with one behavioural nuance kept on
 * purpose: adding a row FROM a <thead> row inserts at the top of <tbody>,
 * because thead repeats on every printed page — a data row must never land
 * inside it. Colspan/rowspan are out of scope for v1, as before.
 */

function rowOf(el: Element): HTMLTableRowElement | null {
  return el.closest('tr')
}

function tableOf(el: Element): HTMLTableElement | null {
  return el.closest('table')
}

/** Index of the cell within its row that contains (or is) `el`. */
function cellIndexOf(el: Element): number {
  const cell = el.closest('td, th')
  if (!cell) return -1
  const row = rowOf(cell)
  return row ? Array.prototype.indexOf.call(row.cells, cell) : -1
}

function makeCellsLike(row: HTMLTableRowElement, forHeader: boolean): HTMLTableRowElement {
  const doc = row.ownerDocument
  const fresh = doc.createElement('tr')
  for (const cell of Array.from(row.cells)) {
    const tag = forHeader ? 'th' : 'td'
    const c = doc.createElement(tag)
    // Keep column geometry (widths travel on cells in these templates).
    if (cell.getAttribute('style')) c.setAttribute('style', cell.getAttribute('style')!)
    c.innerHTML = '&nbsp;'
    fresh.appendChild(c)
  }
  return fresh
}

export function addRow(from: Element): HTMLTableRowElement | null {
  const row = rowOf(from)
  const table = tableOf(from)
  if (!row || !table) return null
  const fresh = makeCellsLike(row, false)
  if (row.parentElement?.tagName === 'THEAD') {
    // The nuance: data rows belong to tbody, thead repeats on every page.
    let tbody = table.querySelector('tbody')
    if (!tbody) {
      tbody = table.ownerDocument.createElement('tbody')
      table.appendChild(tbody)
    }
    tbody.insertBefore(fresh, tbody.firstChild)
  } else {
    row.after(fresh)
  }
  return fresh
}

export function deleteRow(from: Element): boolean {
  const row = rowOf(from)
  const table = tableOf(from)
  if (!row || !table) return false
  // Refuse to delete the last row — delete the table instead, explicitly.
  if (table.rows.length <= 1) return false
  row.remove()
  return true
}

export function addColumn(from: Element): boolean {
  const table = tableOf(from)
  const index = cellIndexOf(from)
  if (!table || index < 0) return false
  for (const row of Array.from(table.rows)) {
    const ref = row.cells[Math.min(index, row.cells.length - 1)]
    if (!ref) continue
    const fresh = table.ownerDocument.createElement(ref.tagName.toLowerCase())
    fresh.innerHTML = '&nbsp;'
    ref.after(fresh)
  }
  return true
}

export type BorderMode = 'all' | 'outer' | 'none'

/** Border presets for the whole table, as inline styles — the only channel
 * that survives export (the author's <style> is read-only in the canvas).
 * 'all' rules every cell, 'outer' frames just the table, 'none' clears both.
 * Anything fancier stays a Code-mode job on purpose. */
export function setTableBorders(from: Element, mode: BorderMode, width = 1): boolean {
  const table = tableOf(from)
  if (!table) return false
  const border = `${width}px solid #000`
  table.style.borderCollapse = 'collapse'
  table.style.border = mode === 'none' ? '' : border
  for (const cell of Array.from(table.querySelectorAll('td, th'))) {
    ;(cell as HTMLElement).style.border = mode === 'all' ? border : ''
  }
  return true
}

export function deleteColumn(from: Element): boolean {
  const table = tableOf(from)
  const index = cellIndexOf(from)
  if (!table || index < 0) return false
  // Refuse to delete the last column for the same reason as the last row.
  if (Array.from(table.rows).every((r) => r.cells.length <= 1)) return false
  for (const row of Array.from(table.rows)) {
    row.cells[index]?.remove()
  }
  return true
}
