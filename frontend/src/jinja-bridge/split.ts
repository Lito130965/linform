/**
 * Template splitting for the visual editor.
 *
 * A DOM-based editor must never let the template's <style> blocks become
 * editable content or be re-serialized through a model that reorders rules
 * or drops @page. So the template is split string-level into prefix /
 * editable body / suffix; the style TEXTS are injected into the canvas
 * read-only, and reassembly is plain concatenation.
 *
 * <style> in the body is not code-only: the header/footer blocks and the
 * page-numbers preset put their @page rules there on purpose (WeasyPrint
 * honours a body <style>, and it keeps the read-only author CSS untouched).
 * Such blocks are HOISTED to the top of the body on entering Visual — the
 * canvas shows their text read-only just like a head <style>, the running
 * elements they drive stay editable in the body, and the only thing that
 * ever moves is page-level CSS, whose position does not affect rendering.
 * Round-trip stays byte-exact whenever the body has no <style> at all.
 */

export type SplitResult =
  | { ok: true; prefix: string; body: string; suffix: string; styles: string }
  | { ok: false; reason: string }

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi

function extractStyleTexts(fragment: string): string {
  const parts: string[] = []
  for (const m of fragment.matchAll(STYLE_BLOCK_RE)) parts.push(m[1])
  return parts.join('\n')
}

/** Pull every <style> out of the editable body and append the nodes to the
 * end of the prefix (i.e. to the top of the body region), so they render in
 * the canvas but never sit in editable content. */
function hoistBodyStyles(prefix: string, body: string): { prefix: string; body: string } {
  const nodes = body.match(STYLE_BLOCK_RE)
  if (!nodes) return { prefix, body }
  return { prefix: prefix + nodes.join(''), body: body.replace(STYLE_BLOCK_RE, '') }
}

export function splitForVisual(html: string): SplitResult {
  const bodyOpen = /<body\b[^>]*>/i.exec(html)
  if (bodyOpen) {
    const closeIdx = html.toLowerCase().lastIndexOf('</body>')
    if (closeIdx === -1) return { ok: false, reason: '<body> is never closed' }
    const bodyStart = bodyOpen.index + bodyOpen[0].length
    const hoisted = hoistBodyStyles(html.slice(0, bodyStart), html.slice(bodyStart, closeIdx))
    return {
      ok: true,
      prefix: hoisted.prefix,
      body: hoisted.body,
      suffix: html.slice(closeIdx),
      styles: extractStyleTexts(hoisted.prefix),
    }
  }

  // Headless template: doctype, comments and <style> blocks at the very
  // top form the prefix; everything after is the editable body.
  let i = 0
  while (i < html.length) {
    const rest = html.slice(i)
    const ws = /^\s+/.exec(rest)
    if (ws) {
      i += ws[0].length
      continue
    }
    if (/^<!doctype/i.test(rest)) {
      const gt = rest.indexOf('>')
      if (gt === -1) break
      i += gt + 1
      continue
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->')
      if (end === -1) break
      i += end + 3
      continue
    }
    if (/^<style\b/i.test(rest)) {
      const end = rest.toLowerCase().indexOf('</style>')
      if (end === -1) return { ok: false, reason: '<style> is never closed' }
      i += end + '</style>'.length
      continue
    }
    break
  }
  if (/<(html|head)\b/i.test(html.slice(i))) {
    return { ok: false, reason: 'document markup without <body> — this template is code-only' }
  }
  const hoisted = hoistBodyStyles(html.slice(0, i), html.slice(i))
  return { ok: true, prefix: hoisted.prefix, body: hoisted.body, suffix: '', styles: extractStyleTexts(hoisted.prefix) }
}

export function joinFromVisual(prefix: string, body: string, suffix: string): string {
  return prefix + body + suffix
}

/**
 * GrapesJS exports its wrapper as a <body> tag; the template's own <body>
 * (when it has one) already lives in the split prefix/suffix. Unwrap the
 * editor's wrapper so body tags never nest or accumulate across visual
 * editing sessions. Wrapper attributes are dropped deliberately: page-level
 * styling belongs to the template's own markup, edited in Code mode.
 */
export function unwrapBody(html: string): string {
  const m = /^\s*<body[^>]*>([\s\S]*)<\/body>\s*$/i.exec(html)
  return m ? m[1] : html
}
