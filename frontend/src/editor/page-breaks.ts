/**
 * What a page break will do to the thing it passes through.
 *
 * The canvas lays a document out as one continuous strip and draws a line where
 * each printed page ends. That line is honest about *where* the page ends and
 * silent about what happens to whatever it crosses — and "it looked right in
 * the editor and printed differently" is the complaint every tool in this class
 * collects. The gap cannot be closed without reflowing the document twice; it
 * can be made predictable, which is what people mean by usable.
 *
 * Two outcomes, and the difference is whether the renderer may split the thing:
 *
 * - **moves** — it goes to the next page whole. A table row, an image, anything
 *   carrying `break-inside: avoid`. These are the ones that surprise people:
 *   a row half-drawn on page one is not what prints.
 * - **splits** — the renderer breaks it across the pages, which is what a
 *   paragraph of text does and usually what its author wants.
 *
 * The report is per boundary, and it names the innermost unit the break is
 * really about: a table crossing a page is not news, the row it happens to
 * land on is. So the search descends until it finds something the renderer
 * keeps together, or until nothing inside is crossed any more.
 *
 * Pure, over a plain tree of measured boxes, so the rule is tested without a
 * layout engine — jsdom has none.
 */

export interface BoxNode {
  /** canvas y of the box's top and bottom */
  top: number
  bottom: number
  /** the renderer will not break this one across pages */
  keepsTogether: boolean
  children: BoxNode[]
  /** identifies the node to the caller; ignored here */
  key?: string
}

export type BreakVerdict = 'moves' | 'splits'

export interface Crossing {
  node: BoxNode
  boundary: number
  verdict: BreakVerdict
}

const crosses = (node: BoxNode, boundary: number): boolean =>
  node.top < boundary - 0.5 && node.bottom > boundary + 0.5

/** Every boundary that passes through content, and the unit it is about. */
export function crossingsAt(root: BoxNode, boundaries: number[]): Crossing[] {
  const found: Crossing[] = []
  for (const boundary of boundaries) {
    const hit = deepestCrossed(root, boundary)
    if (hit) {
      found.push({
        node: hit,
        boundary,
        verdict: hit.keepsTogether ? 'moves' : 'splits',
      })
    }
  }
  return found
}

/** Descend to the unit the break is about: the first thing the renderer keeps
 * together, or the last thing that is crossed at all. */
function deepestCrossed(node: BoxNode, boundary: number): BoxNode | null {
  let current: BoxNode | null = null
  for (const child of node.children) {
    if (!crosses(child, boundary)) continue
    current = child
    if (child.keepsTogether) return child
    const deeper = deepestCrossed(child, boundary)
    if (deeper) return deeper
  }
  return current
}

export const VERDICT_LABEL: Record<BreakVerdict, string> = {
  moves: 'moves to the next page whole',
  splits: 'splits across the break',
}
