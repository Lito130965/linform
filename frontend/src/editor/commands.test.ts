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
