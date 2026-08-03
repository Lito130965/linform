// @vitest-environment jsdom
/**
 * Where a block is allowed to land.
 *
 * The case that matters is the table: "after this cell" is a place a paragraph
 * cannot be, and the parser answers by lifting it out of the table altogether —
 * so a preset dropped into a cell turns up beside the whole table. Every
 * assertion here is about not asking the parser to do something impossible.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { place, placementFor } from './placement'

let root: HTMLElement

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root">
      <p id="intro">Intro</p>
      <table id="table">
        <tbody id="tbody">
          <tr id="row"><td id="cell">a</td><th id="head">b</th></tr>
        </tbody>
      </table>
    </div>`
  root = document.getElementById('root')!
})

const el = (id: string): Element => document.getElementById(id)!

describe('choosing a place', () => {
  it('puts a block INSIDE a cell, never beside one', () => {
    expect(placementFor(el('cell'), 'after')).toEqual({ el: el('cell'), where: 'inside' })
    expect(placementFor(el('head'), 'before')).toEqual({ el: el('head'), where: 'inside' })
  })

  it('sends a block aimed at a row or a section outside the table', () => {
    // Nothing block-level can sit between rows; the table is the nearest thing
    // that has an outside.
    expect(placementFor(el('row'), 'after')).toEqual({ el: el('table'), where: 'after' })
    expect(placementFor(el('tbody'), 'before')).toEqual({ el: el('table'), where: 'before' })
  })

  it('leaves ordinary blocks alone', () => {
    expect(placementFor(el('intro'), 'after')).toEqual({ el: el('intro'), where: 'after' })
    expect(placementFor(el('intro'), 'before')).toEqual({ el: el('intro'), where: 'before' })
    expect(placementFor(el('table'), 'after')).toEqual({ el: el('table'), where: 'after' })
  })
})

describe('putting it there', () => {
  it('appends into a cell', () => {
    const node = document.createElement('p')
    node.textContent = 'preset'
    place(node, placementFor(el('cell'), 'after'))

    expect(el('cell').contains(node), 'the preset landed outside the cell').toBe(true)
    expect(root.querySelector('table')!.contains(node)).toBe(true)
  })

  it('inserts either side of an ordinary block', () => {
    const before = document.createElement('p')
    const after = document.createElement('p')
    place(before, placementFor(el('intro'), 'before'))
    place(after, placementFor(el('intro'), 'after'))

    expect(el('intro').previousElementSibling).toBe(before)
    expect(el('intro').nextElementSibling).toBe(after)
  })

  it('lands a block aimed at a row after the whole table', () => {
    const node = document.createElement('p')
    place(node, placementFor(el('row'), 'after'))

    expect(el('table').nextElementSibling).toBe(node)
    expect(el('table').contains(node)).toBe(false)
  })
})
