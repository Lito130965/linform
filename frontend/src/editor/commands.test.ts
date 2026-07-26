// @vitest-environment jsdom
/** Table operations, snapshot history and inline formatting — the command
 * layer of the custom editor, all pure DOM. */

import { describe, expect, it } from 'vitest'
import { SnapshotHistory } from './history'
import { addColumn, addRow, deleteColumn, deleteRow } from './table-ops'
import { setAlign, toggleInline } from './text-commands'

function bodyOf(html: string): HTMLElement {
  const el = document.createElement('body')
  el.innerHTML = html
  return el
}

const TABLE =
  '<table><thead><tr><th style="width: 20mm">A</th><th>B</th></tr></thead>' +
  '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>'

describe('table-ops', () => {
  it('adds a row after the current one', () => {
    const b = bodyOf(TABLE)
    const firstDataRow = b.querySelectorAll('tbody tr')[0]
    addRow(firstDataRow.querySelector('td')!)
    expect(b.querySelectorAll('tbody tr')).toHaveLength(3)
    // The fresh row landed right after the origin row.
    expect(firstDataRow.nextElementSibling!.textContent).not.toContain('3')
  })

  it('adding from a thead row lands at the top of tbody, never in thead', () => {
    const b = bodyOf(TABLE)
    addRow(b.querySelector('th')!)
    expect(b.querySelectorAll('thead tr')).toHaveLength(1)
    const firstBody = b.querySelector('tbody tr')!
    expect(firstBody.querySelectorAll('td')).toHaveLength(2)
    expect(firstBody.textContent).not.toContain('1')
    // Column geometry travels: the style came from the thead cells.
    expect(firstBody.cells[0].getAttribute('style')).toBe('width: 20mm')
  })

  it('deletes a row but refuses to delete the last one', () => {
    const b = bodyOf('<table><tbody><tr><td>only</td></tr></tbody></table>')
    expect(deleteRow(b.querySelector('td')!)).toBe(false)
    const b2 = bodyOf(TABLE)
    expect(deleteRow(b2.querySelector('tbody td')!)).toBe(true)
    expect(b2.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('adds and deletes a column across every row including thead', () => {
    const b = bodyOf(TABLE)
    addColumn(b.querySelector('tbody td')!)
    for (const row of Array.from(b.querySelectorAll('tr'))) {
      expect((row as HTMLTableRowElement).cells).toHaveLength(3)
    }
    deleteColumn(b.querySelector('tbody td')!)
    for (const row of Array.from(b.querySelectorAll('tr'))) {
      expect((row as HTMLTableRowElement).cells).toHaveLength(2)
    }
  })

  it('refuses to delete the last column', () => {
    const b = bodyOf('<table><tbody><tr><td>x</td></tr></tbody></table>')
    expect(deleteColumn(b.querySelector('td')!)).toBe(false)
  })
})

describe('SnapshotHistory', () => {
  it('walks back and forward through states', () => {
    const h = new SnapshotHistory('a')
    h.commit('b')
    h.commit('c')
    expect(h.undo()).toBe('b')
    expect(h.undo()).toBe('a')
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBe('b')
    expect(h.redo()).toBe('c')
    expect(h.redo()).toBeNull()
  })

  it('a new edit after undo drops the redo branch', () => {
    const h = new SnapshotHistory('a')
    h.commit('b')
    h.undo()
    h.commit('c')
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe('a')
  })

  it('identical states do not pile up', () => {
    const h = new SnapshotHistory('a')
    h.commit('a')
    expect(h.canUndo).toBe(false)
  })
})

describe('text-commands', () => {
  function selectContents(el: Element): void {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  it('wraps a clean selection and unwraps it on the second toggle', () => {
    const host = document.body.appendChild(document.createElement('div'))
    host.innerHTML = '<p>hello world</p>'
    selectContents(host.querySelector('p')!)
    toggleInline(document, 'bold')
    expect(host.innerHTML).toBe('<p><b>hello world</b></p>')
    toggleInline(document, 'bold')
    expect(host.innerHTML).toBe('<p>hello world</p>')
    host.remove()
  })

  it('setAlign styles the nearest block, not the inline target', () => {
    const host = document.body.appendChild(document.createElement('div'))
    host.innerHTML = '<td><span id="s">x</span></td>'
    setAlign(host.querySelector('#s')!, 'right')
    // td got dropped by the parser outside a table; the div is the block.
    expect((host as HTMLElement).style.textAlign || host.querySelector<HTMLElement>('[style]')?.style.textAlign).toBeTruthy()
    host.remove()
  })
})

describe('furniture parsing', () => {
  const CSS = `
    @page {
      size: A4;
      margin-bottom: 35mm;
      @bottom-left { content: element(footer); }
      @top-right {
        content: "Страница " counter(page) " из " counter(pages);
        font-size: 8pt;
      }
    }
    div.footer { position: running(footer); font-size: 8pt; }
  `

  it('reads margin boxes with counters as a human preview', async () => {
    const { parseMarginBoxes } = await import('./furniture')
    const boxes = parseMarginBoxes(CSS)
    const top = boxes.find((b) => b.edge === 'top')!
    expect(top.slot).toBe('right')
    expect(top.preview).toBe('Страница ⟨1⟩ из ⟨N⟩')
    const bottom = boxes.find((b) => b.edge === 'bottom')!
    expect(bottom.runningName).toBe('footer')
    expect(bottom.preview).toContain('element footer')
  })

  it('finds the selector of a running element and badges its true edge', async () => {
    const { runningSelectors, runningAffordanceCss } = await import('./furniture')
    expect(runningSelectors(CSS)).toEqual([{ selector: 'div.footer', name: 'footer' }])
    const css = runningAffordanceCss(CSS)
    expect(css).toContain('div.footer')
    expect(css).toContain('bottom of every printed page')
  })

  it('ignores css without @page or running', async () => {
    const { parseMarginBoxes, runningSelectors } = await import('./furniture')
    expect(parseMarginBoxes('body { color: red }')).toEqual([])
    expect(runningSelectors('body { position: relative }')).toEqual([])
  })
})

describe('setTableBorders', () => {
  it('rules every cell, frames the outside, and clears', async () => {
    const { setTableBorders } = await import('./table-ops')
    const b = bodyOf(TABLE)
    const cell = b.querySelector('td')!
    setTableBorders(cell, 'all')
    expect((b.querySelector('table') as HTMLElement).style.border).toContain('solid')
    expect((cell as HTMLElement).style.border).toContain('1px')
    setTableBorders(cell, 'outer')
    expect((cell as HTMLElement).style.border).toBe('')
    expect((b.querySelector('table') as HTMLElement).style.border).toContain('solid')
    setTableBorders(cell, 'none')
    expect((b.querySelector('table') as HTMLElement).style.border).toBe('')
  })
})

describe('column and row sizing', () => {
  it('setColumnWidth sizes every cell in the column, not one', async () => {
    const { setColumnWidth } = await import('./table-ops')
    const b = bodyOf(TABLE)
    setColumnWidth(b.querySelector('tbody td')!, '40mm')
    // Column 0 across thead + both body rows.
    const col0 = [...b.querySelectorAll('tr')].map((r) => (r as HTMLTableRowElement).cells[0])
    expect(col0.every((c) => (c as HTMLElement).style.width === '40mm')).toBe(true)
    // Column 1 untouched.
    expect((b.querySelectorAll('tr')[0] as HTMLTableRowElement).cells[1].style.width).toBe('')
  })

  it('setRowHeight sizes the row', async () => {
    const { setRowHeight } = await import('./table-ops')
    const b = bodyOf(TABLE)
    const cell = b.querySelector('tbody td')!
    setRowHeight(cell, '15mm')
    expect((cell.closest('tr') as HTMLElement).style.height).toBe('15mm')
  })
})

describe('image layer', () => {
  it('page background is fixed and repeats, behind is pinned under text, normal clears', async () => {
    const { setLayer, layerOf } = await import('./layer')
    const host = document.body.appendChild(document.createElement('div'))
    host.innerHTML = '<p>text</p><img src="asset://x">'
    const img = host.querySelector('img') as HTMLImageElement

    setLayer(img, 'page')
    expect(img.style.position).toBe('fixed')
    expect(img.style.zIndex).toBe('-1')
    expect(layerOf(img)).toBe('page')

    setLayer(img, 'behind')
    expect(img.style.position).toBe('absolute')
    expect(img.style.zIndex).toBe('-1')
    expect(host.style.position).toBe('relative') // anchor added
    expect(layerOf(img)).toBe('behind')

    setLayer(img, 'normal')
    expect(img.style.position).toBe('')
    expect(host.style.position).toBe('') // anchor removed
    expect(layerOf(img)).toBe('normal')
    host.remove()
  })
})

describe('parsePageBox', () => {
  it('reads A4 size and margins for a full-bleed background', async () => {
    const { parsePageBox } = await import('./furniture')
    const box = parsePageBox('@page { size: A4; margin: 20mm 15mm; }')!
    expect(box.width).toBe('210mm')
    expect(box.height).toBe('297mm')
    expect(box.margin).toEqual({ top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' })
  })

  it('swaps dimensions for landscape and returns null without @page size', async () => {
    const { parsePageBox } = await import('./furniture')
    expect(parsePageBox('@page { size: A4 landscape; margin: 0 }')!.width).toBe('297mm')
    expect(parsePageBox('body { color: red }')).toBeNull()
  })
})

describe('image layer: cell background and full-bleed page', () => {
  it('cell background fills the nearest cell and anchors it', async () => {
    const { setLayer, layerOf } = await import('./layer')
    const b = bodyOf('<table><tbody><tr><td><img src="asset://x"></td></tr></tbody></table>')
    const img = b.querySelector('img') as HTMLImageElement
    setLayer(img, 'cell')
    expect(img.style.position).toBe('absolute')
    expect(img.style.width).toBe('100%')
    expect(img.style.right).toBe('0px')
    expect((b.querySelector('td') as HTMLElement).style.position).toBe('relative')
    expect(layerOf(img)).toBe('cell')
  })

  it('page background bleeds past the margins when a page box is given', async () => {
    const { setLayer } = await import('./layer')
    const host = document.body.appendChild(document.createElement('div'))
    host.innerHTML = '<img src="asset://x">'
    const img = host.querySelector('img') as HTMLImageElement
    setLayer(img, 'page', { width: '210mm', height: '297mm', margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' } })
    expect(img.style.position).toBe('fixed')
    expect(img.style.top).toBe('-20mm')
    expect(img.style.width).toBe('210mm')
    expect(img.dataset.lfPagebg).toBe('1')
    host.remove()
  })
})
