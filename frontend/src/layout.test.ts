import { describe, expect, it } from 'vitest'
import { fitZoom, layoutFor } from './layout'

describe('layoutFor', () => {
  it('keeps every panel in its own column on a wide screen', () => {
    expect(layoutFor(1920)).toEqual({
      overlayPanels: false,
      collapseSidebar: false,
      tooNarrow: false,
    })
  })

  it('floats the panels on a 1440 laptop, where a 400px column would eat the canvas', () => {
    const l = layoutFor(1440)
    expect(l.overlayPanels).toBe(true)
    expect(l.collapseSidebar).toBe(false)
  })

  it('also folds the sidebar at 1100', () => {
    const l = layoutFor(1100)
    expect(l.overlayPanels).toBe(true)
    expect(l.collapseSidebar).toBe(true)
    expect(l.tooNarrow).toBe(false)
  })

  it('declares itself too narrow below 1000', () => {
    expect(layoutFor(900).tooNarrow).toBe(true)
    expect(layoutFor(1000).tooNarrow).toBe(false)
  })
})

describe('fitZoom', () => {
  it('leaves a page that already fits at full size', () => {
    expect(fitZoom(1000, 794)).toBe(100)
  })

  it('never magnifies beyond 100%', () => {
    expect(fitZoom(2000, 794)).toBe(100)
  })

  it('shrinks an A4 page to the space available', () => {
    expect(fitZoom(600, 794)).toBe(76)
  })

  it('stops shrinking at the floor rather than becoming unreadable', () => {
    expect(fitZoom(100, 794)).toBe(40)
    expect(fitZoom(100, 794, 25)).toBe(25)
  })

  it('falls back to 100% when a dimension is unknown', () => {
    expect(fitZoom(0, 794)).toBe(100)
    expect(fitZoom(600, 0)).toBe(100)
  })
})
