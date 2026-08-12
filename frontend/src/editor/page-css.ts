/**
 * The page itself, as something you can change.
 *
 * The canvas had a "Page: A4" menu that changed the canvas and nothing else:
 * choosing A5 drew an A5 sheet and printed A4, with nothing anywhere saying so.
 * Size, orientation, margins and the page background all live in `@page`, in
 * the template's own stylesheet, and that stylesheet was read-only in visual
 * mode — so the one property every printed document has could only be set by
 * going to Code.
 *
 * This reads and writes it, on the TEMPLATE SOURCE rather than on the canvas's
 * copy of the CSS, so the same function serves both modes and there is one
 * answer to "what size is this page".
 *
 * **The cascade is left alone.** A document can hold several `@page` rules —
 * the header, footer and page-number blocks each add one to reserve their strip
 * of margin. Reading takes them in order, as a browser would; writing goes to
 * the first rule and never deletes from the others, so adding a header does not
 * become a thing that silently loses its space. Where a later rule wins,
 * `laterOverrides` says which side and what set it, and the panel can say so
 * rather than appearing not to work.
 */

export interface PageMargins {
  top: string
  right: string
  bottom: string
  left: string
}

export interface PageSetup {
  /** 'A4' | 'A5' | 'A3' | 'Letter', or '' when the document does not say. */
  size: string
  landscape: boolean
  margin: PageMargins
  /** As authored — a colour or a url(), or null when unset. */
  background: string | null
}

export const PAGE_SIZES = ['A4', 'A5', 'A3', 'Letter'] as const

const DEFAULT_MARGIN = '20mm'

export const DEFAULT_SETUP: PageSetup = {
  size: 'A4',
  landscape: false,
  margin: { top: DEFAULT_MARGIN, right: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN },
  background: null,
}

// ------------------------------------------------------------------ parsing

/** Body of the balanced block starting at `css[open] === '{'`. */
function blockBody(css: string, open: number): { body: string; end: number } {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return { body: css.slice(open + 1, i), end: i }
    }
  }
  return { body: css.slice(open + 1), end: css.length }
}

interface PageRule {
  /** Index of the `@` in the source. */
  start: number
  /** Index just past the closing brace. */
  end: number
  /** Index of the opening brace. */
  open: number
  body: string
}

/** Every `@page` rule in a stylesheet, in cascade order. */
function pageRules(css: string): PageRule[] {
  const out: PageRule[] = []
  const re = /@page\b[^{]*\{/g
  for (const m of Array.from(css.matchAll(re))) {
    const open = m.index! + m[0].length - 1
    const { body, end } = blockBody(css, open)
    out.push({ start: m.index!, open, body, end: end + 1 })
  }
  return out
}

/** A rule body with its nested margin boxes removed, so declarations inside
 * `@top-center { … }` are not mistaken for the page's own. */
function ownDeclarations(body: string): string {
  let out = ''
  let i = 0
  while (i < body.length) {
    const at = body.indexOf('@', i)
    if (at === -1) {
      out += body.slice(i)
      break
    }
    out += body.slice(i, at)
    const brace = body.indexOf('{', at)
    if (brace === -1) break
    i = blockBody(body, brace).end + 1
  }
  return out
}

function declaration(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;}]+)`, 'i')
  const m = re.exec(ownDeclarations(body))
  return m ? m[1].trim() : null
}

/** margin shorthand: 1–4 values in CSS order. */
function expandMargin(value: string): PageMargins {
  const parts = value.trim().split(/\s+/)
  const [t, r = t, b = t, l = r] = parts
  return { top: t, right: r, bottom: b, left: l }
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/** The style text of every `<style>` block in a template, in document order. */
export function styleTexts(html: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  const re = /<style\b[^>]*>/gi
  for (const m of Array.from(html.matchAll(re))) {
    const from = m.index! + m[0].length
    const close = html.toLowerCase().indexOf('</style>', from)
    if (close === -1) break
    out.push({ text: html.slice(from, close), start: from, end: close })
  }
  return out
}

/** What the document says the page is, taking every rule in cascade order. */
export function readPageSetup(html: string): PageSetup {
  const setup: PageSetup = {
    ...DEFAULT_SETUP,
    size: '',
    margin: { ...DEFAULT_SETUP.margin },
  }
  let sawMargin = false

  for (const style of styleTexts(html)) {
    for (const rule of pageRules(style.text)) {
      const size = declaration(rule.body, 'size')
      if (size) {
        const named = /(a3|a4|a5|letter)/i.exec(size)
        if (named) {
          setup.size = named[1].length === 2 ? named[1].toUpperCase() : 'Letter'
          setup.landscape = /landscape/i.test(size)
        }
      }
      const margin = declaration(rule.body, 'margin')
      if (margin) {
        setup.margin = expandMargin(margin)
        sawMargin = true
      }
      for (const side of SIDES) {
        const one = declaration(rule.body, `margin-${side}`)
        if (one) {
          setup.margin[side] = one
          sawMargin = true
        }
      }
      const background = declaration(rule.body, 'background') ?? declaration(rule.body, 'background-color')
      if (background) setup.background = background
    }
  }
  if (!sawMargin) setup.margin = { ...DEFAULT_SETUP.margin }
  return setup
}

/** Sides a rule after the first one overrides, and the value it sets — so the
 * panel can say why a margin it just wrote is not the one on the page. */
export function laterOverrides(html: string): { side: string; value: string }[] {
  const out: { side: string; value: string }[] = []
  const rules = styleTexts(html).flatMap((style) => pageRules(style.text))
  for (const rule of rules.slice(1)) {
    const margin = declaration(rule.body, 'margin')
    if (margin) {
      for (const side of SIDES) out.push({ side, value: expandMargin(margin)[side] })
    }
    for (const side of SIDES) {
      const one = declaration(rule.body, `margin-${side}`)
      if (one) out.push({ side, value: one })
    }
  }
  // The last writer of each side is the one that wins.
  const seen = new Map<string, string>()
  for (const entry of out) seen.set(entry.side, entry.value)
  return [...seen].map(([side, value]) => ({ side, value }))
}

/** Classes the page-number preset writes, and the rules that make them print.
 *
 * A counter can only be printed by a pseudo-element, and a pseudo-element can
 * only be given content by a stylesheet — so the two halves of a page number
 * are an empty span in the document and a rule beside it. Measured rather than
 * assumed: inside a running element the counter follows the page it is drawn
 * on, so a number placed in a footer counts up as the pages do
 * (tests/test_engine_capabilities.py).
 */
export const PAGE_NO_CLASS = 'lf-page-no'
export const PAGE_COUNT_CLASS = 'lf-page-count'

const COUNTER_RULES =
  `.${PAGE_NO_CLASS}::after { content: counter(page); }\n` +
  `.${PAGE_COUNT_CLASS}::after { content: counter(pages); }`

/** Make sure a template carries those rules, once. */
export function ensurePageCounterRules(html: string): string {
  if (html.includes(`.${PAGE_NO_CLASS}::after`)) return html
  const styles = styleTexts(html)
  if (styles.length > 0) {
    const style = styles[0]
    return html.slice(0, style.end) + `\n${COUNTER_RULES}\n` + html.slice(style.end)
  }
  const block = `<style>\n${COUNTER_RULES}\n</style>\n`
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return html.slice(0, at) + `\n${block}` + html.slice(at)
  }
  return block + html
}

// ------------------------------------------------------------------ writing

const OWNED_PROPS = new Set([
  'size',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'background',
  'background-color',
])

/** Drop the declarations this panel owns from a run of plain CSS.
 *
 * By splitting rather than by regex: a pattern that has to match the separator
 * consumes it, so the second of two declarations in a row is never seen — which
 * is exactly what happened, and why writing the page twice used to leave two
 * margins in the rule.
 */
function stripOwned(plain: string): string {
  return plain
    .split(';')
    .filter((declaration) => !OWNED_PROPS.has(declaration.split(':')[0].trim().toLowerCase()))
    .join(';')
}

/** Strip the declarations this panel owns, leaving everything else — including
 * nested margin boxes — exactly as it was. */
function withoutOwned(body: string): string {
  let out = ''
  let i = 0
  while (i < body.length) {
    const at = body.indexOf('@', i)
    out += stripOwned(at === -1 ? body.slice(i) : body.slice(i, at))
    if (at === -1) break
    const brace = body.indexOf('{', at)
    if (brace === -1) {
      out += body.slice(at)
      break
    }
    const end = blockBody(body, brace).end
    out += body.slice(at, end + 1)
    i = end + 1
  }
  return out
}

function declarations(setup: PageSetup): string {
  const size = setup.size ? `${setup.size}${setup.landscape ? ' landscape' : ''}` : ''
  const m = setup.margin
  const margin =
    m.top === m.right && m.right === m.bottom && m.bottom === m.left
      ? m.top
      : `${m.top} ${m.right} ${m.bottom} ${m.left}`
  const lines = [size ? `  size: ${size};` : '', `  margin: ${margin};`]
  if (setup.background) lines.push(`  background: ${setup.background};`)
  return lines.filter(Boolean).join('\n')
}

/**
 * Write the page setup into the template's own stylesheet.
 *
 * Into the FIRST `@page` rule when there is one, so the document keeps the
 * shape its author gave it; into a new rule in the first `<style>` otherwise;
 * and into a new `<style>` when the template has none at all.
 */
export function writePageSetup(html: string, setup: PageSetup): string {
  const styles = styleTexts(html)

  for (const style of styles) {
    const [first] = pageRules(style.text)
    if (!first) continue
    const kept = withoutOwned(first.body).replace(/^\s*;+/, '').trimEnd()
    const body = `\n${declarations(setup)}${kept.trim() ? `\n${kept.replace(/^\n+/, '')}` : '\n'}`
    const rewritten =
      style.text.slice(0, first.open) + `{${body}}` + style.text.slice(first.end)
    return html.slice(0, style.start) + rewritten + html.slice(style.end)
  }

  const rule = `@page {\n${declarations(setup)}\n}\n`
  if (styles.length > 0) {
    const style = styles[0]
    return html.slice(0, style.start) + `\n${rule}` + html.slice(style.start)
  }

  const block = `<style>\n${rule}</style>\n`
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return html.slice(0, at) + `\n${block}` + html.slice(at)
  }
  return block + html
}
