/**
 * The arithmetic behind the modifier keys.
 *
 * What matters in both of these is which axis wins. Choosing per drag rather
 * than per axis is what stops a corner from fighting the pointer, and a rule
 * that picks the wrong one feels like the tool arguing with you — which is
 * exactly what a familiar modifier is supposed to prevent.
 */

import { describe, expect, it } from 'vitest'
import { isDuplicating, keepRatio, lockAxis } from './modifiers'

describe('keeping the proportion', () => {
  const original = { width: 100, height: 50 } // 2:1

  it('follows the axis the hand moved furthest along', () => {
    // Dragged mostly sideways: the width is what was meant.
    expect(keepRatio(200, 60, original)).toEqual({ width: 200, height: 100 })
    // Dragged mostly downwards: the height is.
    expect(keepRatio(110, 150, original)).toEqual({ width: 300, height: 150 })
  })

  it('holds the proportion whichever way it was dragged', () => {
    for (const [w, h] of [
      [180, 55],
      [105, 120],
      [40, 45],
    ]) {
      const result = keepRatio(w, h, original)
      expect(result.width / result.height).toBeCloseTo(2, 5)
    }
  })

  it('shrinks as readily as it grows', () => {
    expect(keepRatio(50, 48, original)).toEqual({ width: 50, height: 25 })
  })

  it('leaves a degenerate box alone rather than dividing by zero', () => {
    expect(keepRatio(80, 40, { width: 0, height: 50 })).toEqual({ width: 80, height: 40 })
  })
})

describe('locking to an axis', () => {
  it('keeps the direction the movement is mostly along', () => {
    expect(lockAxis(40, 6)).toEqual({ dx: 40, dy: 0 })
    expect(lockAxis(-3, 25)).toEqual({ dx: 0, dy: 25 })
  })

  it('settles a tie towards horizontal, so the choice is never a flicker', () => {
    expect(lockAxis(20, -20)).toEqual({ dx: 20, dy: 0 })
  })
})

describe('duplicating', () => {
  it('reads Ctrl and Command as the same intent', () => {
    expect(isDuplicating({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isDuplicating({ ctrlKey: false, metaKey: true })).toBe(true)
    expect(isDuplicating({ ctrlKey: false, metaKey: false })).toBe(false)
  })
})
