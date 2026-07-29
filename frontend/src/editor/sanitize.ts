/**
 * Strip executable markup before it reaches the canvas.
 *
 * The canvas iframe MUST be same-origin — the editor drives it through
 * `contentDocument`, which a `sandbox` attribute would cut off. So a `<script>`
 * inside a template would run in the editor's own origin, with access to
 * everything the editor holds. A template is untrusted input by design (that is
 * the product: users paste HTML, import .docx, and an assistant writes markup),
 * so it is sanitized on the way in.
 *
 * None of this is visible in the PDF — WeasyPrint ignores scripts entirely.
 * The risk is purely to the person editing the template, which is exactly why
 * it is easy to miss.
 *
 * Parsing happens in a detached document via DOMParser: it builds no live
 * browsing context, so nothing executes and no resource is fetched while we
 * inspect it. Content-Security-Policy is the second line behind this (see
 * app/core/headers.py); neither replaces the other.
 */

/** Elements that execute, embed, or import — removed with their subtree. */
const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset']

/** URL-bearing attributes worth checking for script-y schemes. */
const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster']

export interface SanitizeResult {
  html: string
  /** Human-readable notes on what was removed, for a UI warning. Empty when
   * the input was already clean — the overwhelmingly common case. */
  removed: string[]
}

function isDangerousUrl(value: string): boolean {
  // Strip whitespace and control characters first: `java\tscript:` and
  // `java\0script:` are parsed as the scheme by browsers but sail past a naive
  // startsWith check.
  const normalized = value.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')
}

/** Strip executable markup from a body FRAGMENT (what the canvas consumes).
 *
 * Fragment, not a whole document: the input is wrapped in <body>, so a full
 * document passed here would lose its <head> — use scanForExecutableMarkup()
 * to inspect a whole template without rewriting it.
 *
 * Re-serializing is safe for the canvas specifically because the fragment is
 * about to be parsed and re-serialized anyway (`body.innerHTML = …`, exported
 * with `body.innerHTML`), and that trip is idempotent — asserted by the spike
 * round-trip gate. Nothing here costs byte-exactness that the canvas did not
 * already spend. */
export function sanitizeHtml(html: string): SanitizeResult {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const removed = stripExecutable(doc.body)
  return { html: doc.body.innerHTML, removed }
}

/** Report executable markup anywhere in a template WITHOUT touching it.
 *
 * For whole documents (the assistant's output, a pasted template): rewriting
 * one through the DOM would normalize the author's bytes — quoting, attribute
 * order, the doctype — and byte-exact preservation of the template is a
 * promise this project keeps. So the answer here is a warning, not an edit;
 * enforcement happens at the canvas, the only place the markup can run. */
export function scanForExecutableMarkup(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return stripExecutable(doc.documentElement)
}

/** Shared walk. Mutates the detached tree it is given and reports findings;
 * callers decide whether the mutated tree or only the report is used. */
function stripExecutable(root: Element): string[] {
  const removed: string[] = []

  for (const tag of FORBIDDEN_TAGS) {
    for (const el of Array.from(root.querySelectorAll(tag))) {
      el.remove()
      removed.push(`<${tag}>`)
    }
  }

  // rel=import is a dead spec but still executes in some engines; a stylesheet
  // link is fine and stays.
  for (const link of Array.from(root.querySelectorAll('link'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase()
    if (rel.includes('import')) {
      link.remove()
      removed.push('<link rel=import>')
    }
  }

  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        removed.push(`${name}=`)
        continue
      }
      if (URL_ATTRS.includes(name) && isDangerousUrl(attr.value)) {
        el.removeAttribute(attr.name)
        removed.push(`${name}=${attr.value.slice(0, 24)}…`)
      }
    }
  }

  return [...new Set(removed)]
}

/** One-line summary for a UI warning, or null when nothing was found. */
export function describeRemoved(removed: string[], stripped = true): string | null {
  if (removed.length === 0) return null
  const shown = removed.slice(0, 5).join(', ')
  const rest = removed.length > 5 ? ` and ${removed.length - 5} more` : ''
  const verb = stripped
    ? 'Removed executable markup from the visual canvas'
    : 'This template contains executable markup'
  return `${verb}: ${shown}${rest}. It never runs in the visual editor and never reaches the PDF — WeasyPrint ignores scripts.`
}
