/**
 * Page geometry. These numbers come from a real regression: an A4 form with
 * `@page { margin: 10mm 15mm 15mm 15mm }` had its page-2 line drawn two rows
 * too low in the canvas, because the canvas treated the whole sheet as usable
 * content height instead of subtracting the margins every page spends.
 */

import { describe, expect, it } from 'vitest'
import {
  canPaginate,
  gapToNextPage,
  pageBreakOffsets,
  pageCountFor,
  pageIndexAt,
  usablePageHeight,
} from './pagination'

const MM = 96 / 25.4 // px per mm at 96dpi, the canvas scale

/** The template that exposed the bug: A4, 10mm top / 15mm bottom margin. */
const A4 = { pageHeight: 1123, marginTop: 10 * MM, marginBottom: 15 * MM }

describe('usable height', () => {
  it('is the sheet minus the margins spent on every page', () => {
    // 297mm - 10mm - 15mm = 272mm, not 297mm.
    expect(usablePageHeight(A4)).toBeCloseTo(1123 - 25 * MM, 5)
    expect(usablePageHeight(A4)).toBeLessThan(A4.pageHeight)
  })

  it('refuses geometry that cannot hold content', () => {
    expect(canPaginate(null)).toBe(false)
    expect(canPaginate({ pageHeight: 0, marginTop: 0, marginBottom: 0 })).toBe(false)
    // Margins wider than the sheet: no usable band at all.
    expect(canPaginate({ pageHeight: 100, marginTop: 60, marginBottom: 60 })).toBe(false)
    expect(canPaginate(A4)).toBe(true)
  })
})

describe('break offsets', () => {
  it('places the first break a bottom margin above the sheet edge', () => {
    // The old model drew this line at 1123 (the sheet edge); the truth is
    // 15mm higher, because page 1 ends where its bottom margin begins.
    const [first] = pageBreakOffsets(3000, A4)
    expect(first).toBeCloseTo(A4.marginTop + usablePageHeight(A4), 5)
    expect(1123 - first).toBeCloseTo(15 * MM, 5)
  })

  it('accumulates the error the old model would have made', () => {
    // Old model: k * pageHeight. True: marginTop + k * usable.
    // Drift = k*(mT+mB) - mT — 15mm on page 1, 40mm on page 2, and so on.
    const offsets = pageBreakOffsets(4000, A4)
    for (const [k, offset] of offsets.entries()) {
      const oldModel = (k + 1) * A4.pageHeight
      const drift = oldModel - offset
      expect(drift).toBeCloseTo((k + 1) * 25 * MM - 10 * MM, 4)
    }
    // Concretely: the page-2 line was 40mm too low, about two rows of a form.
    expect(pageBreakOffsets(4000, A4)[1]).toBeCloseTo(2 * 1123 - 40 * MM, 4)
  })

  it('gives one fewer offset than pages — the last page has no break', () => {
    const usable = usablePageHeight(A4)
    const twoPages = A4.marginTop + usable * 1.5
    expect(pageCountFor(twoPages, A4)).toBe(2)
    expect(pageBreakOffsets(twoPages, A4)).toHaveLength(1)
  })

  it('a document that fits on one page has no breaks', () => {
    const short = A4.marginTop + usablePageHeight(A4) - 1
    expect(pageCountFor(short, A4)).toBe(1)
    expect(pageBreakOffsets(short, A4)).toEqual([])
  })
})

describe('page index', () => {
  it('maps an edge to the page it prints on', () => {
    const usable = usablePageHeight(A4)
    expect(pageIndexAt(A4.marginTop, A4)).toBe(0)
    expect(pageIndexAt(A4.marginTop + usable - 1, A4)).toBe(0)
    expect(pageIndexAt(A4.marginTop + usable + 1, A4)).toBe(1)
    // Content above the first band (inside the top margin) is still page 0.
    expect(pageIndexAt(0, A4)).toBe(0)
  })
})

describe('gap to the next page (explicit page breaks)', () => {
  it('pushes to the next content band, not to the next sheet edge', () => {
    const usable = usablePageHeight(A4)
    const edge = A4.marginTop + usable / 2
    const gap = gapToNextPage(edge, A4)
    expect(edge + gap).toBeCloseTo(A4.marginTop + usable, 5)
    // The old model would have pushed to 1123 — a whole bottom margin further.
    expect(edge + gap).toBeLessThan(A4.pageHeight)
  })

  it('is zero when the edge already starts a page', () => {
    expect(gapToNextPage(A4.marginTop, A4)).toBe(0)
    expect(gapToNextPage(A4.marginTop + usablePageHeight(A4), A4)).toBe(0)
  })

  it('never returns a negative gap', () => {
    for (const edge of [-50, 0, 10, 5000]) {
      expect(gapToNextPage(edge, A4)).toBeGreaterThanOrEqual(0)
    }
  })

  it('is inert without usable geometry', () => {
    expect(gapToNextPage(100, { pageHeight: 0, marginTop: 0, marginBottom: 0 })).toBe(0)
  })
})

describe('page count', () => {
  it('counts by usable height, so a long form needs more pages than the naive model', () => {
    const usable = usablePageHeight(A4)
    expect(pageCountFor(A4.marginTop + usable * 3, A4)).toBe(3)
    expect(pageCountFor(A4.marginTop + usable * 3 + 1, A4)).toBe(4)
    // The naive model (content / pageHeight) would under-count this document.
    const content = A4.marginTop + usable * 3 + 1
    expect(Math.ceil(content / A4.pageHeight)).toBeLessThan(pageCountFor(content, A4))
  })

  it('is at least one, even for empty content', () => {
    expect(pageCountFor(0, A4)).toBe(1)
    expect(pageCountFor(-100, A4)).toBe(1)
  })
})
