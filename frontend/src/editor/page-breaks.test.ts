/**
 * Which element a page break is really about.
 *
 * The distinction under test is the one a person cares about: a table crossing
 * a page is not news, the row that lands on the line is — and whether that row
 * moves whole or is split decides whether what they are looking at is what will
 * print.
 */

import { describe, expect, it } from 'vitest'
import { crossingsAt, type BoxNode } from './page-breaks'

const box = (
  key: string,
  top: number,
  bottom: number,
  keepsTogether = false,
  children: BoxNode[] = [],
): BoxNode => ({ key, top, bottom, keepsTogether, children })

describe('finding the unit a break is about', () => {
  it('names the row rather than the table around it', () => {
    const table = box('table', 0, 400, false, [
      box('row1', 0, 180, true),
      box('row2', 180, 320, true),
      box('row3', 320, 400, true),
    ])
    const root = box('body', 0, 400, false, [table])

    const [crossing] = crossingsAt(root, [200])
    expect(crossing.node.key).toBe('row2')
    expect(crossing.verdict).toBe('moves')
  })

  it('says a paragraph splits, because that is what the renderer does to it', () => {
    const root = box('body', 0, 400, false, [box('para', 100, 300)])
    const [crossing] = crossingsAt(root, [200])
    expect(crossing.node.key).toBe('para')
    expect(crossing.verdict).toBe('splits')
  })

  it('stops at the first thing kept together and does not descend past it', () => {
    // The cell inside the row is crossed too; reporting it would be answering a
    // question nobody asked.
    const root = box('body', 0, 400, false, [
      box('row', 100, 300, true, [box('cell', 100, 300, false, [box('text', 100, 300)])]),
    ])
    const [crossing] = crossingsAt(root, [200])
    expect(crossing.node.key).toBe('row')
  })

  it('descends through things that are not kept together', () => {
    const root = box('body', 0, 400, false, [
      box('section', 0, 400, false, [box('inner', 150, 250, true)]),
    ])
    expect(crossingsAt(root, [200])[0].node.key).toBe('inner')
  })
})

describe('what is not a crossing', () => {
  it('ignores a boundary that lands between two elements', () => {
    const root = box('body', 0, 400, false, [box('a', 0, 200), box('b', 200, 400)])
    expect(crossingsAt(root, [200])).toEqual([])
  })

  it('ignores a boundary below everything', () => {
    const root = box('body', 0, 100, false, [box('a', 0, 100)])
    expect(crossingsAt(root, [200])).toEqual([])
  })

  it('tolerates a half-pixel, which is all layout ever agrees to', () => {
    const root = box('body', 0, 400, false, [box('a', 0, 200.3), box('b', 200.3, 400)])
    expect(crossingsAt(root, [200])).toEqual([])
  })
})

describe('several pages', () => {
  it('reports each boundary that passes through something', () => {
    const root = box('body', 0, 900, false, [
      box('a', 0, 350),
      box('b', 350, 700, true),
      box('c', 700, 900),
    ])
    const found = crossingsAt(root, [300, 600])
    expect(found.map((c) => [c.node.key, c.verdict])).toEqual([
      ['a', 'splits'],
      ['b', 'moves'],
    ])
  })
})
