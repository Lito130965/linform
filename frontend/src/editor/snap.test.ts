/**
 * Snapping arithmetic.
 *
 * The cases worth protecting are the ones where snapping does the wrong thing
 * quietly: pulling to the grid when a real alignment was nearer, picking the
 * less meaningful of two lines at the same distance, or refusing to leave a
 * value alone when nothing is close — the last is what makes fine adjustment
 * possible at all.
 */

import { describe, expect, it } from 'vitest'
import { edgeLines, snapTo, toMm, type SnapLine } from './snap'

const page = (at: number): SnapLine => ({ at, kind: 'page' })
const edge = (at: number): SnapLine => ({ at, kind: 'edge' })

describe('falling onto a line', () => {
  it('lands exactly on the nearest line within reach', () => {
    const result = snapTo(103, [page(100), edge(180)], { threshold: 6 })
    expect(result.value).toBe(100)
    expect(result.line).toEqual(page(100))
  })

  it('leaves the value alone when nothing is near', () => {
    // Without this there is no fine adjustment: every drag would jump.
    const result = snapTo(140, [page(100), edge(180)], { threshold: 6 })
    expect(result.value).toBe(140)
    expect(result.line).toBeNull()
  })

  it('prefers a nearer line to a more authoritative one', () => {
    expect(snapTo(178, [page(100), edge(180)], { threshold: 6 }).value).toBe(180)
  })

  it('breaks a tie towards the more meaningful line', () => {
    // A cell edge sitting exactly on a margin is the common case, and the guide
    // should say "page", because that is what the author was aiming at.
    const result = snapTo(100, [{ at: 100, kind: 'center' }, page(100)], { threshold: 6 })
    expect(result.line?.kind).toBe('page')
  })
})

describe('the grid as a fallback', () => {
  it('rounds to the grid when no line is in reach', () => {
    const result = snapTo(48, [page(200)], { threshold: 6, gridStep: 10 })
    expect(result.value).toBe(50)
    expect(result.line?.kind).toBe('grid')
  })

  it('never overrides a real alignment with a round number', () => {
    // The margin is at 98; the grid would say 100. Snapping to the grid here
    // would be the editor preferring its own opinion to the document's.
    const result = snapTo(97, [page(98)], { threshold: 6, gridStep: 10 })
    expect(result.value).toBe(98)
    expect(result.line?.kind).toBe('page')
  })

  it('leaves the value alone when even the grid is out of reach', () => {
    expect(snapTo(45, [], { threshold: 2, gridStep: 10 }).value).toBe(45)
  })
})

describe('switching it off', () => {
  it('a zero threshold snaps to nothing at all', () => {
    // What Alt does while dragging: the document wins over every helper.
    const result = snapTo(101, [page(100)], { threshold: 0, gridStep: 10 })
    expect(result.value).toBe(101)
    expect(result.line).toBeNull()
  })
})

describe('what other elements offer', () => {
  it('gives both edges and the middle of each rectangle', () => {
    const lines = edgeLines([{ left: 10, right: 30, top: 0, bottom: 8 }], 'x')
    expect(lines).toEqual([
      { at: 10, kind: 'edge' },
      { at: 30, kind: 'edge' },
      { at: 20, kind: 'center' },
    ])
  })

  it('reads the other axis when asked', () => {
    const lines = edgeLines([{ left: 10, right: 30, top: 0, bottom: 8 }], 'y')
    expect(lines.map((l) => l.at)).toEqual([0, 8, 4])
  })
})

describe('saying it in millimetres', () => {
  it('converts at the ratio the browser uses, to a tenth', () => {
    expect(toMm(96)).toBe(25.4)
    expect(toMm(37.795)).toBe(10)
  })
})
