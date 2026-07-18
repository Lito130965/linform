/** Clipboard HTML from Word / Google Docs is a swamp: mso-* styles,
 * conditional comments, o:p tags, class soup. Pasting that into a template
 * would poison the PDF forever, so pasted markup is reduced to an allowlist
 * of structural tags and attributes — the mammoth philosophy applied to the
 * clipboard. Presentation is the template's own CSS's job. */

const ALLOWED_ATTRS: Record<string, string[]> = {
  p: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  table: [], thead: [], tbody: [], tfoot: [],
  tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
  ul: [], ol: [], li: [],
  b: [], strong: [], i: [], em: [], u: [], s: [], sub: [], sup: [],
  br: [], hr: [], blockquote: [],
  a: ['href'],
  img: ['src', 'alt'],
  div: [], span: [],
}

/** Tags whose content is garbage too, not just the tag itself. */
const DROP_WITH_CONTENT = new Set(['style', 'script', 'meta', 'link', 'title', 'head', 'xml'])

function cleanNode(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove()
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    const tag = el.tagName.toLowerCase()

    if (DROP_WITH_CONTENT.has(tag) || tag.includes(':')) {
      el.remove()
      continue
    }

    const allowed = ALLOWED_ATTRS[tag]
    if (allowed === undefined) {
      // Unknown tag: unwrap — keep the content, lose the wrapper.
      const parent = el.parentNode
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
        el.remove()
        cleanNode(parent)
        continue
      }
    } else {
      for (const attr of Array.from(el.attributes)) {
        if (!allowed.includes(attr.name.toLowerCase())) el.removeAttribute(attr.name)
      }
      if (tag === 'img') {
        const src = el.getAttribute('src') ?? ''
        // Clipboard images referencing local files can never render.
        if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
          el.remove()
          continue
        }
      }
      cleanNode(el)
    }
  }
}

export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  cleanNode(doc.body)
  return doc.body.innerHTML.trim()
}
