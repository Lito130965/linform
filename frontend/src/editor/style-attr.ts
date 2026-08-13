/**
 * Editing the style attribute without losing what the browser cannot parse.
 *
 * `position: running(lf-footer)` is the whole mechanism behind a header or a
 * footer, and no browser implements it — so it is not in the CSSOM. It survives
 * only as text in the style ATTRIBUTE, and only for as long as nothing rebuilds
 * that attribute.
 *
 * Writing through `el.style` does exactly that: the attribute is reserialised
 * from the declarations the parser kept, and everything it threw away goes with
 * it. Aligning a footer, or changing its font, turned it into an ordinary block
 * — silently, and only visible once the PDF came back without a footer.
 *
 * So style edits go through here instead: the attribute is parsed as text,
 * amended as text, and written back as text. What the browser did not
 * understand it never sees, and therefore cannot drop. That is true of any
 * engine-specific CSS a template carries, not only of running elements.
 *
 * Pure string work over one attribute, so it is testable without a layout
 * engine.
 */

/** Split a style attribute into declarations, ignoring semicolons inside
 * parentheses (`url(data:…;base64,…)`) and quotes. */
export function readDeclarations(style: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0
  let quote: string | null = null
  let start = 0

  const push = (text: string): void => {
    const at = text.indexOf(':')
    if (at === -1) return
    const property = text.slice(0, at).trim()
    const value = text.slice(at + 1).trim()
    if (property && value) out.push([property, value])
  }

  for (let i = 0; i < style.length; i++) {
    const ch = style[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      push(style.slice(start, i))
      start = i + 1
    }
  }
  push(style.slice(start))
  return out
}

export function writeDeclarations(declarations: readonly [string, string][]): string {
  return declarations.map(([property, value]) => `${property}: ${value}`).join('; ')
}

/**
 * Set or remove declarations on an element, keeping every other one exactly as
 * it was written — including the ones the browser cannot parse.
 *
 * A null or empty value removes the property, which is how a control returns
 * something to the stylesheet rather than writing a zero over it.
 */
export function setDeclarations(el: Element, patch: Record<string, string | null>): void {
  const kept = readDeclarations(el.getAttribute('style') ?? '')
  const wanted = new Map(Object.entries(patch))
  const out: [string, string][] = []

  for (const [property, value] of kept) {
    if (!wanted.has(property)) {
      out.push([property, value])
      continue
    }
    const next = wanted.get(property)
    wanted.delete(property)
    if (next) out.push([property, next])
  }
  // Anything the element did not already carry goes on the end.
  for (const [property, value] of wanted) {
    if (value) out.push([property, value])
  }

  const text = writeDeclarations(out)
  if (text) el.setAttribute('style', text)
  else el.removeAttribute('style')
}

/** One property, for the common case. */
export function setDeclaration(el: Element, property: string, value: string | null): void {
  setDeclarations(el, { [property]: value })
}
