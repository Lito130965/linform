/**
 * Turning a header or a footer on, and giving it a band to live in.
 *
 * In paged CSS a header is two halves that have to agree: a `@page` margin box
 * that pulls an element (`@top-center { content: element(lf-header) }`) and an
 * element that offers itself to it (`position: running(lf-header)`). Either one
 * alone does nothing — the box prints empty, or the element prints nowhere —
 * which is not something anybody should have to know to put a company name at
 * the top of a form.
 *
 * So it is one switch, and it writes both halves. The band's height is the
 * `@page` margin on that edge, because that is exactly what a margin box
 * occupies: the strip between the paper edge and the content. Word calls the
 * same thing the top margin, and the header lives inside it.
 *
 * Deliberately `@top-center` and `@bottom-center` alone: with no left or right
 * box beside it, a centre box spans the whole content width, so the element
 * inside is a full-width container. Three things across the page — a name on
 * the left, a page number in the middle, a code on the right — is then an
 * ordinary three-column block inside it, made of the same parts as everything
 * else in the document rather than of a special header syntax.
 *
 * Source-level: the template text goes in and comes out, so Code and Visual
 * agree and the change is visible as a diff.
 */

import { splitForVisual } from '../jinja-bridge'
import { styleTexts } from './page-css'

export type Edge = 'top' | 'bottom'

/** The running name each edge uses. Fixed, so the switch can find its own work
 * again on the next visit. */
export const RUNNING_NAME: Record<Edge, string> = {
  top: 'lf-header',
  bottom: 'lf-footer',
}

const BOX: Record<Edge, string> = { top: '@top-center', bottom: '@bottom-center' }

/** Is there a margin box on this edge pulling an element? */
export function hasFurniture(html: string, edge: Edge): boolean {
  const re = new RegExp(`@${edge}-(?:left|center|right)\\s*\\{[^}]*element\\(`, 'i')
  return styleTexts(html).some((style) => re.test(style.text))
}

/** Is the element that offers itself to that box actually in the document? */
export function hasRunningElement(html: string, edge: Edge): boolean {
  return new RegExp(`position:\\s*running\\(\\s*${RUNNING_NAME[edge]}\\s*\\)`, 'i').test(html)
}

const DEFAULT_TEXT: Record<Edge, string> = { top: 'Header', bottom: 'Footer' }

export function runningElementHtml(edge: Edge): string {
  return (
    `<div style="position: running(${RUNNING_NAME[edge]}); font-size: 9pt; color: #555;">` +
    `${DEFAULT_TEXT[edge]}</div>`
  )
}

/** Put the element in the body — the header first, the footer last, so Code
 * mode reads in the order the page does. */
function addElement(html: string, edge: Edge): string {
  const split = splitForVisual(html)
  if (!split.ok) return html
  const one = runningElementHtml(edge) + '\n'
  const body = edge === 'top' ? one + split.body : split.body + one
  return split.prefix + body + split.suffix
}

/** Take it out again, with whatever was put inside it. */
function removeElement(html: string, edge: Edge): string {
  const name = RUNNING_NAME[edge]
  const open = new RegExp(`<div[^>]*position:\\s*running\\(\\s*${name}\\s*\\)[^>]*>`, 'i')
  const match = open.exec(html)
  if (!match) return html

  // Balanced: the element may hold blocks of its own now, and a lazy match to
  // the first </div> would cut it in half and leave the rest on the page.
  let depth = 0
  let i = match.index
  const tag = /<\/?div\b[^>]*>/gi
  tag.lastIndex = match.index
  let found: RegExpExecArray | null
  while ((found = tag.exec(html)) !== null) {
    depth += found[0].startsWith('</') ? -1 : 1
    if (depth === 0) {
      i = found.index + found[0].length
      break
    }
  }
  return (html.slice(0, match.index) + html.slice(i)).replace(/\n{3,}/g, '\n\n')
}

/** Add or remove the margin box in the first `@page` rule, and clean the box
 * out of any other rule so a block's own rule cannot resurrect it. */
export function setFurnitureBox(html: string, edge: Edge, on: boolean): string {
  const boxRe = new RegExp(`@${edge}-(?:left|center|right)\\s*\\{[^}]*element\\([^}]*\\}\\s*`, 'gi')
  let out = html
  const styles = styleTexts(out)

  // Remove first, everywhere: one box per edge, and it is the one this writes.
  for (let i = styles.length - 1; i >= 0; i--) {
    const style = styles[i]
    const cleaned = style.text.replace(boxRe, '')
    if (cleaned !== style.text) out = out.slice(0, style.start) + cleaned + out.slice(style.end)
  }
  if (!on) return dropEmptyPageRules(out)

  const rule = /@page\b[^{]*\{/i.exec(out)
  // `width: 100%` is not decoration. A margin box is shrink-to-fit by default —
  // measured: a footer of three columns comes out 37mm wide and centred on a
  // 170mm page area, while the canvas draws the band across the page — so
  // without this the editor and the renderer disagree about the one thing a
  // header is for. See tests/test_engine_capabilities.py.
  const box = `\n  ${BOX[edge]} { content: element(${RUNNING_NAME[edge]}); width: 100%; }`
  if (rule) {
    const at = rule.index + rule[0].length
    return out.slice(0, at) + box + out.slice(at)
  }
  // No @page at all: page-css writes one the moment a size or margin is set,
  // and until then this is where it starts.
  const style = styleTexts(out)[0]
  const fresh = `@page {${box}\n}\n`
  if (style) return out.slice(0, style.start) + `\n${fresh}` + out.slice(style.start)
  return `<style>\n${fresh}</style>\n` + out
}

/** An `@page { }` left holding nothing is litter. */
function dropEmptyPageRules(html: string): string {
  let out = html
  for (const style of styleTexts(out).reverse()) {
    const cleaned = style.text.replace(/@page\b[^{]*\{\s*\}\s*/gi, '')
    if (cleaned !== style.text) out = out.slice(0, style.start) + cleaned + out.slice(style.end)
  }
  // …and a <style> that held only that.
  return out.replace(/<style>\s*<\/style>\s*/gi, '')
}

/**
 * Switch a header or footer on or off — both halves together.
 *
 * Turning one off takes its content with it: a band nobody can see, holding
 * markup that prints nowhere, is worse than an empty page edge. The change is
 * an ordinary edit to the template, so it shows in Code and in the diff.
 */
export function setFurniture(html: string, edge: Edge, on: boolean): string {
  let out = setFurnitureBox(html, edge, on)
  if (on && !hasRunningElement(out, edge)) out = addElement(out, edge)
  if (!on) out = removeElement(out, edge)
  return out
}
