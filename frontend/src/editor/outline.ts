/**
 * The document as a list of its parts.
 *
 * Clicking in the canvas selects the nearest selectable ancestor of whatever is
 * under the cursor, which is the right rule and still leaves one question
 * unanswerable from the page itself: what else is there, and how deep am I? A
 * cell, its row, the table and the block around it all occupy the same pixels,
 * so a click can only ever offer one of them and hovering can only ever describe
 * one of them.
 *
 * The outline answers it by naming everything, which is why the list is built
 * from exactly the same notion of "selectable" the canvas uses (selection.ts).
 * A row that appears here and cannot be selected, or an element that can be
 * selected and is missing here, would make the list a second, disagreeing model
 * of the document — the failure this file exists to avoid.
 *
 * Unselectable wrappers are stepped through rather than shown: the parser puts a
 * <tbody> in every table whether or not the author wrote one, and a level nobody
 * can select is a level nobody wants to walk past.
 *
 * Pure DOM reads, no layout — so this is testable in jsdom, unlike everything
 * that has to measure.
 */

import { KIND_LABEL, kindOf, type NodeKind } from './selection'

export interface OutlineItem {
  el: HTMLElement
  kind: NodeKind
  /** What it is: "Table", "Row", "Heading 1". */
  label: string
  /** Which one it is: the text it starts with, or the expression it holds. */
  detail: string
  /** How deep in the structure, for the indent. */
  depth: number
  /** Holds selectable parts of its own, so it can be opened and closed. */
  container: boolean
}

/** "Block" is the truth and not an answer — a list where nine rows in ten say
 * the same word is a list nobody reads. The tag knows more. */
const TAG_LABEL: Record<string, string> = {
  H1: 'Heading 1',
  H2: 'Heading 2',
  H3: 'Heading 3',
  H4: 'Heading 4',
  H5: 'Heading 5',
  H6: 'Heading 6',
  P: 'Paragraph',
  UL: 'List',
  OL: 'Numbered list',
  LI: 'List item',
  HR: 'Divider',
  BLOCKQUOTE: 'Quote',
  SECTION: 'Section',
  HEADER: 'Header',
  FOOTER: 'Footer',
  DIV: 'Block',
}

export function labelFor(el: HTMLElement): string {
  // A page break is an empty div; without this it reads as "Block", which is
  // the one thing it is not.
  if (el.hasAttribute('data-lf-pagebreak')) return 'Page break'
  const running = el.getAttribute('data-lf-running')
  if (running) return running === 'header' ? 'Page header' : 'Page footer'
  // Templates that were not built from the blocks carry the running position in
  // their own style; which margin box pulls them is the @page rule's business,
  // so this says what is certain about them.
  if (/position:\s*running\(/i.test(el.getAttribute('style') ?? '')) {
    return 'Repeats on every page'
  }
  const kind = kindOf(el)
  if (!kind) return 'Block'
  return kind === 'block' ? (TAG_LABEL[el.tagName] ?? 'Block') : KIND_LABEL[kind]
}

const MAX_DETAIL = 44

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

export function detailFor(el: HTMLElement): string {
  const expression =
    el.getAttribute('data-jinja-expr') ??
    el.getAttribute('data-jinja-for') ??
    el.getAttribute('data-jinja-if') ??
    el.getAttribute('data-jinja-raw')
  if (expression) return shorten(expression)
  if (el.tagName === 'IMG') {
    const alt = el.getAttribute('alt')
    if (alt) return shorten(alt)
    // Content-addressed assets and data URIs are both unreadable in full; the
    // tail of the reference is what a person recognises.
    const src = el.getAttribute('src') ?? ''
    if (src.startsWith('data:')) {
      const cut = src.search(/[;,]/)
      return `${(cut > 5 ? src.slice(5, cut) : '') || 'image'} data`
    }
    return shorten(src.split('/').pop() ?? '')
  }
  return shorten(el.textContent ?? '')
}

/** The selectable parts directly inside an element, stepping through anything
 * that is not selectable itself. */
export function selectableChildren(el: Element): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const child of Array.from(el.children)) {
    if (child.hasAttribute('data-lf-spacer')) continue
    if (kindOf(child)) out.push(child as HTMLElement)
    else out.push(...selectableChildren(child))
  }
  return out
}

/** Beyond this many parts a container starts closed: a hundred static rows are
 * a haystack, and the one thing an outline must never be is somewhere to lose
 * the document. Explicitly opening one always wins over the count. */
export const CROWDED = 12

/** A safety net rather than a policy. Nothing sane reaches it; a template that
 * does would otherwise render tens of thousands of rows into the panel and take
 * the editor down with it. */
const MAX_ITEMS = 4000

export function outlineOf(
  root: HTMLElement,
  isOpen: (el: HTMLElement, children: number) => boolean,
): OutlineItem[] {
  const out: OutlineItem[] = []
  const walk = (parent: Element, depth: number): void => {
    for (const el of selectableChildren(parent)) {
      if (out.length >= MAX_ITEMS) return
      const children = selectableChildren(el)
      out.push({
        el,
        kind: kindOf(el)!,
        label: labelFor(el),
        detail: detailFor(el),
        depth,
        container: children.length > 0,
      })
      if (children.length > 0 && isOpen(el, children.length)) walk(el, depth + 1)
    }
  }
  walk(root, 0)
  return out
}
