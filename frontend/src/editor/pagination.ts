/**
 * Where the printed pages actually end.
 *
 * The canvas lays a template out as ONE continuous strip, but paged media does
 * not work that way: every printed page loses its top and bottom @page margins,
 * so the content that fits on a page is `pageHeight - marginTop - marginBottom`
 * — not `pageHeight`.
 *
 * Getting this wrong is not a rounding error, it accumulates. With A4 and
 * `margin: 10mm 15mm 15mm 15mm` the canvas used to draw its page-2 line 40mm
 * below the true break (`k*H - (mT + k*U) = k*(mT+mB) - mT`), which on a real
 * form was two full rows of content shown on the wrong page.
 *
 * Everything here is in sheet coordinates: y is measured from the top edge of
 * the paper, and the body — which is the page area, inset by the @page margins
 * exactly as it is in print — starts at `marginTop`, where the first page's
 * content band begins.
 *
 * What this does NOT do, deliberately (see README "Limits"): it says where a
 * page ENDS, not what moves. The canvas keeps the document as one continuous
 * strip, so a block straddling a boundary is drawn whole with the line through
 * it, while the renderer pushes it entirely to the next page — and content
 * inside a table cannot be pushed by the canvas at all, since a spacer div
 * cannot live between table rows. Beyond that, the browser and WeasyPrint are
 * different layout engines with different font metrics, and `page-break-inside`,
 * widows and orphans are the renderer's business. The PDF preview stays the
 * source of truth; this model exists to stop the canvas being systematically,
 * cumulatively wrong.
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

/** How many printed pages a strip of content this tall occupies. */
export function pageCountFor(contentHeight: number, g: PageGeometry): number {
  if (!canPaginate(g)) return 1
  const flowing = contentHeight - g.marginTop
  if (flowing <= 0) return 1
  return Math.max(1, Math.ceil(flowing / usablePageHeight(g)))
}

/** Canvas y of the end of each printed page, for the boundary lines. Page k
 * (1-based) ends at `marginTop + k * usable`. Returns `pages - 1` offsets: the
 * last page's end is the end of the document, not a break. */
export function pageBreakOffsets(contentHeight: number, g: PageGeometry): number[] {
  const pages = pageCountFor(contentHeight, g)
  const usable = usablePageHeight(g)
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => g.marginTop + (i + 1) * usable)
}

/** Zero-based index of the page an edge at canvas y falls on. */
export function pageIndexAt(y: number, g: PageGeometry): number {
  const usable = usablePageHeight(g)
  return Math.max(0, Math.floor((y - g.marginTop) / usable))
}

/** Height of the spacer needed to push an edge to the top of the next page's
 * content band — the explicit `page-break` case. Returns 0 when the edge
 * already sits at a page start (nothing to push). */
export function gapToNextPage(edge: number, g: PageGeometry): number {
  if (!canPaginate(g)) return 0
  const usable = usablePageHeight(g)
  const flowing = edge - g.marginTop
  // An edge exactly on a boundary is already at the top of the next page.
  const boundaries = Math.ceil(flowing / usable)
  const nextStart = g.marginTop + boundaries * usable
  const gap = nextStart - edge
  return gap > 0 ? gap : 0
}
