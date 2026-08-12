import { describe, expect, it } from 'vitest'
import {
  bandStart,
  canPaginate,
  gapToNextPage,
  overflowsItsPage,
  pageBreakOffsets,
  pageCountFor,
  pageIndexAt,
  sheetEdges,
  usablePageHeight,
  type PageGeometry,
} from './pagination'

/**
 * A4 at 96dpi with 10mm top and 15mm bottom margins, rounded to whole pixels so
 * the arithmetic in the assertions is readable: a page is 1000 tall, spends 40
 * on the top margin and 60 on the bottom, and holds 900 of content.
 */
const A4: PageGeometry = { pageHeight: 1000, marginTop: 40, marginBottom: 60 }

describe('what a page holds', () => {
  it('is the sheet minus the margins it spends on every page', () => {
    expect(usablePageHeight(A4)).toBe(900)
  })

  it('refuses a geometry that cannot hold anything', () => {
    expect(canPaginate(null)).toBe(false)
    expect(canPaginate({ pageHeight: 0, marginTop: 0, marginBottom: 0 })).toBe(false)
    expect(canPaginate({ pageHeight: 100, marginTop: 60, marginBottom: 60 })).toBe(false)
    expect(canPaginate(A4)).toBe(true)
  })
})

describe('how many sheets the strip holds', () => {
  it('counts the sheets needed to hold what is drawn', () => {
    // 940 is the first page full to its last printable line.
    expect(pageCountFor(940, A4)).toBe(1)
    // Past that is the bottom margin: the renderer carries it to page two, so
    // there is a second sheet even before the strip is a sheet and a bit tall.
    expect(pageCountFor(941, A4)).toBe(2)
    expect(pageCountFor(1000, A4)).toBe(2)
    expect(pageCountFor(1040, A4)).toBe(2)
    expect(pageCountFor(1940, A4)).toBe(2)
    expect(pageCountFor(2000, A4)).toBe(3)
  })

  it('is never less than one, whatever the content does', () => {
    expect(pageCountFor(0, A4)).toBe(1)
    expect(pageCountFor(-50, A4)).toBe(1)
  })
})

describe('where the lines go', () => {
  it('ends each page content band one bottom margin above the paper edge', () => {
    expect(pageBreakOffsets(2400, A4)).toEqual([940, 1940])
  })

  it('puts the paper edges at whole sheets', () => {
    expect(sheetEdges(2400, A4)).toEqual([1000, 2000])
  })

  it('draws nothing for a document that fits on one page', () => {
    expect(pageBreakOffsets(500, A4)).toEqual([])
    expect(sheetEdges(500, A4)).toEqual([])
  })

  it('leaves exactly the two margins between one band and the next', () => {
    // The gap on screen is the footer band plus the header band — which is the
    // whole point: what the furniture costs is visible on every page.
    const [firstEnd] = pageBreakOffsets(2400, A4)
    expect(bandStart(1, A4) - firstEnd).toBe(A4.marginBottom + A4.marginTop)
  })
})

describe('moving a block to the next page', () => {
  it('lands it on the content band, not on the paper edge', () => {
    // A block starting at 900 on page one: it moves to 1040, which is the next
    // sheet's edge plus its top margin.
    expect(gapToNextPage(900, A4)).toBe(140)
    expect(900 + gapToNextPage(900, A4)).toBe(bandStart(1, A4))
  })

  it('measures from where the block is, so the spacer is its own height', () => {
    expect(gapToNextPage(1500, A4)).toBe(bandStart(2, A4) - 1500)
  })

  it('says which page a position is on', () => {
    expect(pageIndexAt(0, A4)).toBe(0)
    expect(pageIndexAt(999, A4)).toBe(0)
    expect(pageIndexAt(1000, A4)).toBe(1)
    expect(pageIndexAt(2400, A4)).toBe(2)
  })
})

describe('which blocks have to move', () => {
  it('moves one that runs past the band it starts in', () => {
    expect(overflowsItsPage(800, 200, A4)).toBe(true) // ends at 1000, band ends at 940
    expect(overflowsItsPage(800, 100, A4)).toBe(false) // ends at 900
  })

  it('leaves one that ends exactly on the boundary', () => {
    expect(overflowsItsPage(840, 100, A4)).toBe(false)
  })

  it('leaves a block taller than a page where it is', () => {
    // Nothing can make it fit, and moving it would only carry the overflow
    // down a sheet — so it crosses, and the page-break warnings say so.
    expect(overflowsItsPage(40, 2000, A4)).toBe(false)
  })

  it('works the same on the second page as on the first', () => {
    expect(overflowsItsPage(1800, 200, A4)).toBe(true)
    expect(overflowsItsPage(1040, 900, A4)).toBe(false)
  })
})
