// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  canMergeDown,
  canMergeRight,
  columnOf,
  isMerged,
  mergeDown,
  mergeRight,
  splitCell,
} from './cells'

let table: HTMLTableElement

beforeEach(() => {
  document.body.innerHTML = `
    <table><tbody>
      <tr><td id="a1">a1</td><td id="b1">b1</td><td id="c1">c1</td></tr>
      <tr><td id="a2">a2</td><td id="b2">b2</td><td id="c2">c2</td></tr>
      <tr><td id="a3">a3</td><td id="b3">b3</td><td id="c3">c3</td></tr>
    </tbody></table>`
  table = document.querySelector('table')!
})

const el = (id: string) => document.getElementById(id)!
const rowText = (n: number) =>
  Array.from(table.rows[n].cells).map((c) => c.textContent!.trim().replace(/ /g, '·'))

describe('merging across', () => {
  it('takes the next cell in, keeping what it said', () => {
    mergeRight(el('a1'))
    expect(el('a1').getAttribute('colspan')).toBe('2')
    // Losing the swallowed cell's content silently is the kind of thing nobody
    // notices until after saving.
    expect(el('a1').textContent).toContain('b1')
    expect(document.getElementById('b1')).toBeNull()
    expect(rowText(0)).toHaveLength(2)
  })

  it('adds the spans up when merging something already merged', () => {
    mergeRight(el('a1'))
    mergeRight(el('a1'))
    expect(el('a1').getAttribute('colspan')).toBe('3')
    expect(rowText(0)).toHaveLength(1)
  })

  it('has nothing to merge at the end of a row', () => {
    expect(canMergeRight(el('c1'))).toBe(false)
    mergeRight(el('c1'))
    expect(rowText(0)).toHaveLength(3)
  })
})

describe('merging down', () => {
  it('takes the cell below into this one', () => {
    mergeDown(el('a1'))
    expect(el('a1').getAttribute('rowspan')).toBe('2')
    expect(document.getElementById('a2')).toBeNull()
    expect(rowText(1)).toHaveLength(2)
  })

  it('finds the cell below by column, not by position in the row', () => {
    // The first cell of row 1 already spans two columns, so c1 is its SECOND
    // child while c2 is the third child of row 2 — counting children would
    // reach for b2 and merge the wrong pair.
    document.body.innerHTML = `
      <table><tbody>
        <tr><td id="wide" colspan="2">wide</td><td id="c1">c1</td></tr>
        <tr><td id="a2">a2</td><td id="b2">b2</td><td id="c2">c2</td></tr>
      </tbody></table>`
    expect(columnOf(el('c1'))).toBe(2)
    mergeDown(el('c1'))
    expect(document.getElementById('c2')).toBeNull()
    expect(document.getElementById('b2')).not.toBeNull()
  })

  it('refuses when the cell below is a different width', () => {
    mergeRight(el('a2'))
    expect(canMergeDown(el('a1'))).toBe(false)
  })

  it('has nothing to merge in the last row', () => {
    expect(canMergeDown(el('a3'))).toBe(false)
  })
})

describe('splitting again', () => {
  it('puts back the cells a sideways merge swallowed', () => {
    mergeRight(el('a1'))
    splitCell(el('a1'))
    expect(el('a1').hasAttribute('colspan')).toBe(false)
    expect(rowText(0)).toHaveLength(3)
  })

  it('puts back the cells a downward merge swallowed, in the right column', () => {
    document.body.innerHTML = `
      <table><tbody>
        <tr><td id="wide" colspan="2">wide</td><td id="c1">c1</td></tr>
        <tr><td id="a2">a2</td><td id="b2">b2</td><td id="c2">c2</td></tr>
      </tbody></table>`
    table = document.querySelector('table')!
    mergeDown(el('c1'))
    splitCell(el('c1'))
    expect(rowText(1)).toHaveLength(3)
    // The replacement went into the third column, after a2 and b2 — empty,
    // since a merge has nothing to give back but the space it took.
    expect(rowText(1).slice(0, 2)).toEqual(['a2', 'b2'])
    expect(rowText(1)[2]).toBe('')
  })

  it('does nothing to a cell that was never merged', () => {
    splitCell(el('b2'))
    expect(rowText(1)).toEqual(['a2', 'b2', 'c2'])
    expect(isMerged(el('b2'))).toBe(false)
  })

  it('handles a block merged both ways', () => {
    mergeRight(el('a1'))
    mergeDown(el('a1'))
    expect(isMerged(el('a1'))).toBe(true)
    splitCell(el('a1'))
    expect(rowText(0)).toHaveLength(3)
    expect(rowText(1)).toHaveLength(3)
  })
})

describe('merging a block that is already wide', () => {
  it('takes every cell under it, not just one', () => {
    // Merge right, then down: the shape of half the headings on a real form,
    // and impossible while "the cell below" could only mean a single cell.
    mergeRight(el('a1'))
    expect(canMergeDown(el('a1'))).toBe(true)
    mergeDown(el('a1'))
    expect(el('a1').getAttribute('colspan')).toBe('2')
    expect(el('a1').getAttribute('rowspan')).toBe('2')
    expect(document.getElementById('a2')).toBeNull()
    expect(document.getElementById('b2')).toBeNull()
    expect(document.getElementById('c2')).not.toBeNull()
  })

  it('refuses when a cell below straddles its edge', () => {
    // b2 would be half in and half out; there is no answer that is not a guess.
    mergeRight(el('a1'))
    mergeRight(el('b2'))
    expect(canMergeDown(el('a1'))).toBe(false)
  })
})
