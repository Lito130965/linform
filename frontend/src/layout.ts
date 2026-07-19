import { useEffect, useState } from 'react'

/** How the editor arranges itself at a given viewport width.
 *
 * The numbers come from measuring the real editor: the A4 canvas is a fixed
 * 794px (210mm at 96dpi), the sidebar 240px and the assistant 400px, and none
 * of them shrink. Side by side that already overflows a 1920px screen, which is
 * why the panels stop taking space of their own below OVERLAY_PANELS_BELOW
 * instead of squeezing the canvas to nothing. */

/** Assistant and history stop reserving a column and float over the preview. */
export const OVERLAY_PANELS_BELOW = 1600
/** The template list folds to a rail; the toggle still opens it. */
export const COLLAPSE_SIDEBAR_BELOW = 1200
/** Below this even a folded sidebar plus two panes cannot hold a usable canvas. */
export const TOO_NARROW_BELOW = 1000

export interface LayoutMode {
  overlayPanels: boolean
  collapseSidebar: boolean
  tooNarrow: boolean
}

export function layoutFor(width: number): LayoutMode {
  return {
    overlayPanels: width < OVERLAY_PANELS_BELOW,
    collapseSidebar: width < COLLAPSE_SIDEBAR_BELOW,
    tooNarrow: width < TOO_NARROW_BELOW,
  }
}

/** Canvas zoom (percent) that fits a page `target` px wide into `available` px.
 *
 * Never magnifies past 100% — a form is authored at its true size — and never
 * shrinks past `min`, below which the text is too small to edit and a scrollbar
 * is the more honest answer. */
export function fitZoom(available: number, target: number, min = 40): number {
  if (target <= 0 || available <= 0) return 100
  const pct = Math.round((available / target) * 100)
  return Math.min(100, Math.max(min, pct))
}

/** Viewport width in CSS pixels, tracked across resizes. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
