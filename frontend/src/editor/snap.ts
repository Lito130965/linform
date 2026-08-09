/**
 * Snapping: what a dragged edge is allowed to fall onto.
 *
 * In a printed form nothing is "roughly there" — a column lines up with the
 * page margin, or with the column above it, or it is wrong. Landing on that by
 * nudging pixels is the part of this editor that felt worst, and it is not a
 * matter of taste: the alignment exists in the document whether or not anyone
 * managed to hit it.
 *
 * Three kinds of line are worth falling onto, in this order of authority:
 *
 * - **page** — the content band: where the margins say the page begins and
 *   ends, and where each printed page breaks. Getting flush with these is what
 *   a form is made of.
 * - **edge / center** — another element's edges, and its middle. Aligning to
 *   what is already on the page is how a layout stays consistent.
 * - **grid** — the millimetre ruler, as a fallback when nothing else is near.
 *   It keeps free movement tidy without pretending to be an alignment.
 *
 * Explicit lines beat the grid: snapping to "5 mm" when the margin sits at
 * 4.8 mm would be the editor overriding the document with its own opinion.
 *
 * Everything is in canvas pixels, the space the drags already work in. The
 * threshold arrives in canvas pixels too — the caller divides the screen
 * distance by the zoom, so the pull feels the same however far you are zoomed
 * out.
 *
 * Pure, so the arithmetic is tested without a layout engine and the canvas only
 * has to decide which lines exist.
 */

export type SnapKind = 'page' | 'edge' | 'center' | 'grid'

export interface SnapLine {
  /** position along the axis, in canvas pixels */
  at: number
  kind: SnapKind
}

export interface Snapped {
  value: number
  /** the line it landed on, for drawing a guide — null when nothing was near */
  line: SnapLine | null
}

/** Rank: a page line wins a tie against an element edge, which wins against a
 * centre. Ties are common — a cell edge often sits exactly on a margin — and
 * the guide should name the more meaningful of the two. */
const AUTHORITY: Record<SnapKind, number> = { page: 0, edge: 1, center: 2, grid: 3 }

export function snapTo(
  value: number,
  lines: SnapLine[],
  options: { threshold: number; gridStep?: number },
): Snapped {
  const { threshold, gridStep = 0 } = options
  if (threshold <= 0) return { value, line: null }

  let best: SnapLine | null = null
  let bestDistance = Infinity
  for (const line of lines) {
    const distance = Math.abs(line.at - value)
    if (distance > threshold) continue
    if (
      distance < bestDistance - 0.001 ||
      (Math.abs(distance - bestDistance) <= 0.001 &&
        best !== null &&
        AUTHORITY[line.kind] < AUTHORITY[best.kind])
    ) {
      best = line
      bestDistance = distance
    }
  }
  if (best) return { value: best.at, line: best }

  if (gridStep > 0) {
    const nearest = Math.round(value / gridStep) * gridStep
    if (Math.abs(nearest - value) <= threshold) {
      return { value: nearest, line: { at: nearest, kind: 'grid' } }
    }
  }
  return { value, line: null }
}

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/** The lines other elements offer along one axis: both edges and the middle. */
export function edgeLines(rects: Rect[], axis: 'x' | 'y'): SnapLine[] {
  const lines: SnapLine[] = []
  for (const rect of rects) {
    const [start, end] = axis === 'x' ? [rect.left, rect.right] : [rect.top, rect.bottom]
    lines.push({ at: start, kind: 'edge' })
    lines.push({ at: end, kind: 'edge' })
    lines.push({ at: (start + end) / 2, kind: 'center' })
  }
  return lines
}

/** Millimetres for a readout, at the ratio the browser resolves `mm` with. */
export function toMm(px: number): number {
  return Math.round((px / (96 / 25.4)) * 10) / 10
}

/** What to say about a snap, in the words of the thing it landed on. */
export const SNAP_LABEL: Record<SnapKind, string> = {
  page: 'page',
  edge: 'edge',
  center: 'centre',
  grid: 'grid',
}
