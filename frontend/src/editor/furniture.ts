/** Page furniture extracted from the template's own CSS, for the canvas.
 *
 * WeasyPrint's headers and footers live in places a browser cannot render:
 * `@page` margin boxes (`@top-right { content: "…" counter(page) }`) are
 * ignored wholesale, and `position: running(name)` is an unknown position, so
 * the element stays in normal flow — which is why a footer written at the top
 * of <body> shows at the top of the canvas. The canvas cannot paginate, but it
 * can be honest: render the margin boxes as strips above/below the page, and
 * badge running elements for what they are.
 */

export interface MarginBox {
  edge: 'top' | 'bottom'
  slot: 'left' | 'center' | 'right'
  /** Human preview: quoted strings verbatim, counter(page) → ⟨1⟩,
   * counter(pages) → ⟨N⟩, element(x) → ⟨element x⟩. */
  preview: string
  /** Set when the box pulls a running element from the document. */
  runningName?: string
}

/** Body of the first balanced block that starts at css[open] === '{'. */
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

function previewOfContent(value: string): { preview: string; runningName?: string } {
  let runningName: string | undefined
  const parts: string[] = []
  const token = /"([^"]*)"|'([^']*)'|counter\(\s*pages\s*\)|counter\(\s*page\s*\)|element\(\s*([\w-]+)\s*\)/g
  for (const m of Array.from(value.matchAll(token))) {
    if (m[1] !== undefined || m[2] !== undefined) parts.push(m[1] ?? m[2] ?? '')
    else if (m[0].includes('pages')) parts.push('⟨N⟩')
    else if (m[0].startsWith('counter')) parts.push('⟨1⟩')
    else {
      runningName = m[3]
      parts.push(`⟨element ${m[3]}⟩`)
    }
  }
  return { preview: parts.join(''), runningName }
}

/** All margin boxes declared inside @page rules of the given CSS. */
export function parseMarginBoxes(css: string): MarginBox[] {
  const out: MarginBox[] = []
  const pageRe = /@page\b[^{]*\{/g
  for (const pm of Array.from(css.matchAll(pageRe))) {
    const page = blockBody(css, pm.index! + pm[0].length - 1)
    const boxRe = /@(top|bottom)-(left|center|right)\s*\{/g
    for (const bm of Array.from(page.body.matchAll(boxRe))) {
      const box = blockBody(page.body, bm.index! + bm[0].length - 1)
      const content = /content\s*:\s*([^;}]+)/.exec(box.body)
      if (!content) continue
      const { preview, runningName } = previewOfContent(content[1])
      out.push({
        edge: bm[1] as 'top' | 'bottom',
        slot: bm[2] as 'left' | 'center' | 'right',
        preview,
        runningName,
      })
    }
  }
  return out
}

/** Selectors whose rule carries position: running(name) — the elements the
 * margin boxes pull out of the flow at print time. */
export function runningSelectors(css: string): { selector: string; name: string }[] {
  const out: { selector: string; name: string }[] = []
  const re = /([^{}]+)\{([^{}]*position\s*:\s*running\(\s*([\w-]+)\s*\)[^{}]*)\}/g
  for (const m of Array.from(css.matchAll(re))) {
    const selector = m[1].trim().split(',')[0].trim()
    if (selector.startsWith('@')) continue
    out.push({ selector, name: m[3] })
  }
  return out
}

/** Canvas-only CSS that badges running elements as the footers/headers they
 * are, instead of letting them masquerade as ordinary top-of-document text. */
export function runningAffordanceCss(css: string): string {
  const boxes = parseMarginBoxes(css)
  const rules: string[] = []
  for (const { selector, name } of runningSelectors(css)) {
    const edge = boxes.find((b) => b.runningName === name)?.edge
    const where = edge === 'top' ? 'top' : 'bottom'
    rules.push(
      `${selector} {
        outline: 1px dashed rgba(181, 138, 42, 0.8);
        outline-offset: 2px;
        position: relative;
        opacity: 0.85;
      }
      ${selector}::before {
        content: "repeats at the ${where} of every printed page";
        display: block;
        font: 9px/1.6 system-ui, sans-serif;
        color: #8a6d1a;
        letter-spacing: 0.3px;
      }`,
    )
  }
  return rules.join('\n')
}
