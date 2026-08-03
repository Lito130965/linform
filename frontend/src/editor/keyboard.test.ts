// @vitest-environment jsdom
/**
 * Structural navigation by keyboard.
 *
 * The rule being protected is that plain typing keeps working: the canvas is
 * contenteditable, so anything that answers a bare arrow, Enter or Backspace
 * has taken a key away from writing the document. Every test that asserts
 * `null` here is asserting exactly that.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { intentFor, selectableChildren, siblingsOf, type KeyLike } from './keyboard'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

const alt = (k: string): KeyLike => key(k, { altKey: true })

let root: HTMLElement

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root">
      <h1 id="title">Invoice</h1>
      <p id="intro">Hello</p>
      <div id="wrapper-not-offered"><span><p id="buried">Inside a wrapper</p></span></div>
      <table id="table">
        <tbody id="tbody">
          <tr id="row1"><td id="cell1">a</td><td id="cell2">b</td></tr>
          <tr id="row2"><td id="cell3">c</td></tr>
        </tbody>
      </table>
      <p id="chip-holder"><span id="chip" data-jinja-expr="total">{{ total }}</span></p>
    </div>`
  root = document.getElementById('root')!
})

const el = (id: string): Element => document.getElementById(id)!

describe('what counts as a level', () => {
  it('steps through wrappers the editor does not offer', () => {
    // <span> is not selectable, so the paragraph inside it belongs to the
    // level above rather than hiding one level down.
    const inside = selectableChildren(el('wrapper-not-offered'))
    expect(inside.map((e) => e.id)).toEqual(['buried'])
  })

  it('lists the top level in document order', () => {
    expect(selectableChildren(root).map((e) => e.id)).toEqual([
      'title',
      'intro',
      'wrapper-not-offered',
      'table',
      'chip-holder',
    ])
  })

  it('treats cells of one row as siblings', () => {
    expect(siblingsOf(el('cell1'), root).map((e) => e.id)).toEqual(['cell1', 'cell2'])
  })
})

describe('moving', () => {
  it('alt+down and alt+up move along the level', () => {
    expect(intentFor(alt('ArrowDown'), el('title'), root)).toEqual({
      action: 'select',
      el: el('intro'),
    })
    expect(intentFor(alt('ArrowUp'), el('intro'), root)).toEqual({
      action: 'select',
      el: el('title'),
    })
  })

  it('stops at the end of a level rather than surfacing somewhere else', () => {
    // cell2 is the last cell of row1. Going further would land in row2, which
    // looks like a jump sideways across the page.
    expect(intentFor(alt('ArrowDown'), el('cell2'), root)).toBeNull()
    expect(intentFor(alt('ArrowUp'), el('title'), root)).toBeNull()
  })

  it('alt+right goes in, alt+left goes out', () => {
    expect(intentFor(alt('ArrowRight'), el('row1'), root)).toEqual({
      action: 'select',
      el: el('cell1'),
    })
    expect(intentFor(alt('ArrowLeft'), el('cell1'), root)).toEqual({
      action: 'select',
      el: el('row1'),
    })
  })

  it('offers a way in when nothing is selected yet', () => {
    // Without this every other shortcut is unreachable from the keyboard.
    expect(intentFor(alt('ArrowDown'), null, root)).toEqual({
      action: 'select',
      el: el('title'),
    })
  })

  it('goes no further out than the canvas itself', () => {
    expect(intentFor(alt('ArrowLeft'), el('title'), root)).toBeNull()
  })
})

describe('acting on the selection', () => {
  it('alt+enter edits a placeholder as an expression', () => {
    expect(intentFor(alt('Enter'), el('chip'), root)).toEqual({
      action: 'editExpression',
      el: el('chip'),
    })
  })

  it('alt+enter on ordinary markup hands over to the caret', () => {
    expect(intentFor(alt('Enter'), el('intro'), root)).toEqual({
      action: 'placeCaret',
      el: el('intro'),
    })
  })

  it('alt+delete and alt+backspace remove the selected element', () => {
    for (const k of ['Delete', 'Backspace']) {
      expect(intentFor(alt(k), el('intro'), root)).toEqual({
        action: 'remove',
        el: el('intro'),
      })
    }
  })

  it('escape clears the selection, and does nothing when there is none', () => {
    expect(intentFor(key('Escape'), el('intro'), root)).toEqual({ action: 'select', el: null })
    expect(intentFor(key('Escape'), null, root)).toBeNull()
  })
})

describe('what typing keeps', () => {
  it('leaves bare arrows, Enter and Backspace to the caret', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Delete']) {
      expect(intentFor(key(k), el('intro'), root), `bare ${k} was taken`).toBeNull()
    }
  })

  it('leaves ctrl and cmd combinations alone', () => {
    // Undo, redo and every browser shortcut live there.
    expect(intentFor(key('z', { ctrlKey: true }), el('intro'), root)).toBeNull()
    expect(intentFor(key('ArrowDown', { metaKey: true, altKey: true }), el('intro'), root)).toBeNull()
  })

  it('ignores keys it has no meaning for', () => {
    expect(intentFor(alt('a'), el('intro'), root)).toBeNull()
  })
})
