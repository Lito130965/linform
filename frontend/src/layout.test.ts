import { describe, expect, it } from 'vitest'
import { fitZoom, layoutFor } from './layout'

describe('layoutFor', () => {
  it('keeps every panel in its own column on a wide screen', () => {
    expect(layoutFor(1920)).toEqual({
      overlayPanels: false,
      collapseSidebar: false,
      previewAsTab: false,
      inspectorOverlay: false,
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

  it('declares itself too narrow below 900', () => {
    // Lowered from 1000 once the columns stopped taking width unconditionally:
    // at 950 the page is whole, and refusing to open was the editor being
    // careful about a problem it no longer has.
    expect(layoutFor(899).tooNarrow).toBe(true)
    expect(layoutFor(900).tooNarrow).toBe(false)
    expect(layoutFor(950).tooNarrow).toBe(false)
  })

  it('does not call an unmeasured window narrow', () => {
    // Zero is not a size, it is the absence of one: a browser can render a
    // page before the window has dimensions — a background tab, a prerendered
    // page — and calling that "too narrow" puts "this window is 0px, open it
    // anyway" in front of somebody at an ordinary screen. Found on the
    // deployed demo, which loaded exactly that way.
    expect(layoutFor(0).tooNarrow).toBe(false)
  })
})

describe('the narrow arrangements', () => {
  it('keeps both columns while there is room for the page between them', () => {
    const l = layoutFor(1281)
    expect(l.previewAsTab).toBe(false)
    expect(l.inspectorOverlay).toBe(false)
  })

  it('turns the preview into a tab and the inspector into an overlay at 1280', () => {
    // Two columns beside an A4 page mean neither is worth looking at; one at a
    // time, chosen, beats both at once and cramped. At the boundary rather than
    // below it: 1280 is the commonest laptop width there is, and the size the
    // layout was measured for — a whole A4 page at 100 %.
    const l = layoutFor(1280)
    expect(l.previewAsTab).toBe(true)
    expect(l.inspectorOverlay).toBe(true)
  })

  it('does not rearrange a window that has not been measured', () => {
    // Same reason as tooNarrow: zero is the absence of a size, and a
    // background tab must not decide the layout for a full-sized screen.
    expect(layoutFor(0).previewAsTab).toBe(false)
    expect(layoutFor(0).inspectorOverlay).toBe(false)
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
