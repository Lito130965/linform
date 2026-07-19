import { describe, expect, it } from 'vitest'
import { fitWithin, MAX_DIMENSION } from './image'

describe('fitWithin', () => {
  it('leaves an image that already fits untouched', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('does not upscale a small image', () => {
    expect(fitWithin(100, 50)).toEqual({ width: 100, height: 50 })
  })

  it('scales a tall screenshot by its longest side', () => {
    // A 4K-ish portrait scan: height is the constraint, aspect ratio survives.
    const { width, height } = fitWithin(2160, 3840)
    expect(height).toBe(MAX_DIMENSION)
    expect(width).toBe(Math.round(2160 * (MAX_DIMENSION / 3840)))
  })

  it('scales a wide screenshot by its longest side', () => {
    const { width, height } = fitWithin(3840, 2160)
    expect(width).toBe(MAX_DIMENSION)
    expect(height).toBe(Math.round(2160 * (MAX_DIMENSION / 3840)))
  })

  it('honours an explicit max', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })
})
