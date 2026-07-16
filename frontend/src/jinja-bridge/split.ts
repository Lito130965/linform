/**
 * Template splitting for the visual editor.
 *
 * A DOM-based editor must never see the template's <style> blocks or
 * document scaffolding: GrapesJS would re-serialize CSS through its own
 * model (reordering rules, dropping @page — the print-critical parts).
 * So the template is split string-level into prefix / editable body /
 * suffix; only the body enters the canvas, the style texts are injected
 * into the canvas read-only, and reassembly is plain concatenation —
 * which keeps the no-edit round-trip byte-exact.
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

export function splitForVisual(html: string): SplitResult {
  const bodyOpen = /<body\b[^>]*>/i.exec(html)
  if (bodyOpen) {
    const closeIdx = html.toLowerCase().lastIndexOf('</body>')
    if (closeIdx === -1) return { ok: false, reason: '<body> is never closed' }
    const bodyStart = bodyOpen.index + bodyOpen[0].length
    const prefix = html.slice(0, bodyStart)
    const body = html.slice(bodyStart, closeIdx)
    if (/<style\b/i.test(body)) {
      return { ok: false, reason: '<style> inside <body> — this template is code-only' }
    }
    return { ok: true, prefix, body, suffix: html.slice(closeIdx), styles: extractStyleTexts(prefix) }
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
  const prefix = html.slice(0, i)
  const body = html.slice(i)
  if (/<style\b/i.test(body)) {
    return { ok: false, reason: '<style> below the content — this template is code-only' }
  }
  if (/<(html|head)\b/i.test(body)) {
    return { ok: false, reason: 'document markup without <body> — this template is code-only' }
  }
  return { ok: true, prefix, body, suffix: '', styles: extractStyleTexts(prefix) }
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
