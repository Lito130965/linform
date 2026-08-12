/**
 * Where the printed pages are, in the canvas.
 *
 * The canvas lays a template out as one continuous strip, but paged media does
 * not work that way: every page spends its top and bottom @page margins, so a
 * page holds `pageHeight - marginTop - marginBottom` of content — not
 * `pageHeight`.
 *
 * Getting this wrong is not a rounding error, it accumulates. With A4 and
 * `margin: 10mm 15mm 15mm 15mm` the canvas used to draw its page-2 line 40mm
 * below the true break, which on a real form was two full rows of content shown
 * on the wrong page.
 *
 * **Each page occupies a whole sheet in the strip.** The strip used to run the
 * content bands together — page 2's content began directly under page 1's, with
 * a line between them — so the margins between sheets existed in the arithmetic
 * and nowhere on screen, and a header or footer could only be shown on the
 * first page. Now page k occupies `[k*pageHeight, (k+1)*pageHeight)` and the
 * gap between two sheets is real space: the footer band of one page, the paper
 * edge, and the header band of the next.
 *
 * That makes the coordinates self-consistent — a position measured in the live
 * document is already the position on the strip, with no bookkeeping about how
 * much spacing has been inserted above it — which is what keeps pagination from
 * feeding back into itself and growing a page per pass.
 *
 * Everything here is in sheet coordinates unless a parameter says otherwise: y
 * is measured from the top edge of the paper, and the body — which is the page
 * area, inset by the @page margins exactly as it is in print — starts at
 * `marginTop`.
 *
 * What this does NOT do, deliberately (see README "Limits"): only top-level
 * blocks are moved, because a spacer cannot live between table rows, and an
 * element taller than a page is left to cross. Beyond that the browser and
 * WeasyPrint are different layout engines with different font metrics, and
 * `page-break-inside`, widows and orphans are the renderer's business. The PDF
 * preview stays the source of truth; this model exists to stop the canvas being
 * systematically, cumulatively wrong.
 *
 * Pure functions with no DOM, so the geometry is testable without a layout
 * engine — jsdom has none.
 */

export interface PageGeometry {
  /** Full sheet height in px (A4 at 96dpi = 1123). */
  pageHeight: number
  /** @page margin-top in px — how far the body is inset on the canvas. */
  marginTop: number
  /** @page margin-bottom in px. */
  marginBottom: number
}

/** Content height one printed page can hold. */
export function usablePageHeight(g: PageGeometry): number {
  return g.pageHeight - g.marginTop - g.marginBottom
}

/** Is this geometry usable at all? Margins wider than the sheet (or a free-width
 * canvas) mean "do not paginate" rather than "divide by something negative". */
export function canPaginate(g: PageGeometry | null): g is PageGeometry {
  return g !== null && g.pageHeight > 0 && usablePageHeight(g) > 0
}

/**
 * How many sheets the strip holds.
 *
 * @param contentHeight sheet y the content reaches — the top margin plus what
 *   the body holds, spacers included, since those are part of the strip
 */
export function pageCountFor(contentHeight: number, g: PageGeometry): number {
  if (!canPaginate(g)) return 1
  const page = pageIndexAt(contentHeight - 0.5, g)
  // Content reaching into a page's bottom margin is content the renderer will
  // carry to the next page — it is past the printable band — so it needs a
  // sheet of its own. Counting by total height alone missed exactly that
  // window, and a document one line too long showed as a single page.
  const bandEnd = (page + 1) * g.pageHeight - g.marginBottom
  return Math.max(1, page + 1 + (contentHeight > bandEnd + 0.5 ? 1 : 0))
}

/** Sheet y where each page's content band ends — one per gap between sheets,
 * so `pages - 1` of them. The last page's content ends where the document does,
 * which is not a break. */
export function pageBreakOffsets(contentHeight: number, g: PageGeometry): number[] {
  const pages = pageCountFor(contentHeight, g)
  return Array.from(
    { length: Math.max(0, pages - 1) },
    (_, i) => (i + 1) * g.pageHeight - g.marginBottom,
  )
}

/** Sheet y of the top edge of each sheet after the first — where one page's
 * paper ends and the next begins. */
export function sheetEdges(contentHeight: number, g: PageGeometry): number[] {
  const pages = pageCountFor(contentHeight, g)
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => (i + 1) * g.pageHeight)
}

/** Zero-based index of the page a sheet y falls on. */
export function pageIndexAt(y: number, g: PageGeometry): number {
  if (!canPaginate(g)) return 0
  return Math.max(0, Math.floor(y / g.pageHeight))
}

/** Sheet y where page `k`'s content band begins. */
export function bandStart(page: number, g: PageGeometry): number {
  return page * g.pageHeight + g.marginTop
}

/**
 * How far a block whose top is at sheet y `top` has to move to begin on the
 * next page's content band.
 *
 * Rects measured inside the canvas are already sheet coordinates, and a spacer
 * inserted in the flow shifts everything after it by its own height — so this
 * number is the spacer's height, with no arithmetic about what was inserted
 * above it. That self-consistency is what keeps pagination from feeding back
 * into itself.
 */
export function gapToNextPage(top: number, g: PageGeometry): number {
  if (!canPaginate(g)) return 0
  const gap = bandStart(pageIndexAt(top, g) + 1, g) - top
  return gap > 0 ? gap : 0
}

/**
 * Does a block starting at sheet y `top` and this tall run past the page it
 * starts on?
 *
 * Blocks taller than a page are excluded: nothing can make one fit, and moving
 * it would only carry the overflow down a sheet.
 */
export function overflowsItsPage(top: number, height: number, g: PageGeometry): boolean {
  if (!canPaginate(g)) return false
  if (height > usablePageHeight(g)) return false
  const bandEnd = (pageIndexAt(top, g) + 1) * g.pageHeight - g.marginBottom
  return top + height > bandEnd + 0.5
}
