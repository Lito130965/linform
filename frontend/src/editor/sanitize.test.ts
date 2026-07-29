// @vitest-environment jsdom
/**
 * The canvas iframe is same-origin by necessity (the editor reads its
 * contentDocument), so a <script> in a template would run with the editor's
 * privileges — including access to the session token. None of it is visible in
 * the PDF, because WeasyPrint ignores scripts, which is exactly what makes it
 * easy to miss.
 */

import { describe, expect, it } from 'vitest'
import { describeRemoved, sanitizeHtml, scanForExecutableMarkup } from './sanitize'

describe('sanitizeHtml (canvas fragments)', () => {
  it('drops script elements and their contents', () => {
    const { html, removed } = sanitizeHtml('<p>keep</p><script>alert(1)</script>')
    expect(html).toBe('<p>keep</p>')
    expect(html).not.toContain('alert')
    expect(removed).toContain('<script>')
  })

  it('drops inline event handlers but keeps the element', () => {
    const { html, removed } = sanitizeHtml('<img src="x.png" onerror="steal()">')
    expect(html).toContain('src="x.png"')
    expect(html).not.toContain('onerror')
    expect(removed).toContain('onerror=')
  })

  it('drops javascript: urls, including obfuscated ones', () => {
    // Browsers ignore control characters and whitespace inside the scheme, so
    // a naive startsWith('javascript:') check misses these.
    for (const url of ['javascript:x', 'JaVaScRiPt:x', 'java\tscript:x', ' javascript:x']) {
      const { html } = sanitizeHtml(`<a href="${url}">t</a>`)
      expect(html, url).not.toContain('script:')
    }
  })

  it('keeps ordinary links and data-uri images (barcodes are data URIs)', () => {
    const kept = '<a href="https://example.com">t</a><img src="data:image/svg+xml;base64,AAA">'
    const { html, removed } = sanitizeHtml(kept)
    expect(html).toContain('https://example.com')
    expect(html).toContain('data:image/svg+xml')
    expect(removed).toEqual([])
  })

  it('drops embedding elements that can host active content', () => {
    const { removed } = sanitizeHtml('<iframe src="e"></iframe><object data="x"></object><embed>')
    expect(removed).toEqual(expect.arrayContaining(['<iframe>', '<object>', '<embed>']))
  })

  it('keeps stylesheet links but drops rel=import', () => {
    const { html } = sanitizeHtml(
      '<link rel="stylesheet" href="a.css"><link rel="import" href="b.html">',
    )
    expect(html).toContain('stylesheet')
    expect(html).not.toContain('import')
  })

  it('leaves clean markup untouched, byte for byte', () => {
    // The overwhelmingly common case must not be rewritten: the canvas relies
    // on parse/serialize being idempotent for its byte-exact round trip.
    const clean = '<table><tbody><tr><td style="width: 20mm">{{ x }}</td></tr></tbody></table>'
    const { html, removed } = sanitizeHtml(clean)
    expect(html).toBe(clean)
    expect(removed).toEqual([])
  })

  it('is idempotent', () => {
    const once = sanitizeHtml('<p onclick="x()">t</p><script>a</script>').html
    expect(sanitizeHtml(once).html).toBe(once)
  })
})

describe('scanForExecutableMarkup (whole templates)', () => {
  const DOC = `<html><head><style>@page { size: A4 }</style></head><body><p>t</p><script>x()</script></body></html>`

  it('finds executable markup anywhere in a full document', () => {
    expect(scanForExecutableMarkup(DOC)).toContain('<script>')
  })

  it('reports nothing for a clean template', () => {
    expect(scanForExecutableMarkup('<html><body><p>{{ x }}</p></body></html>')).toEqual([])
  })

  it('does NOT rewrite: the caller keeps the author bytes', () => {
    // Why this exists separately from sanitizeHtml. Pushing a whole document
    // through the fragment path flattens it: the parser hoists <style> out of
    // <head> and discards the <html>/<head> scaffolding entirely, so what
    // comes back is no longer the document the author wrote.
    const viaFragment = sanitizeHtml(DOC).html
    expect(viaFragment).not.toContain('<head>')
    expect(viaFragment).not.toContain('<html>')
    expect(viaFragment).not.toBe(DOC)
    // The scan reports the same finding while leaving DOC untouched.
    expect(scanForExecutableMarkup(DOC)).toContain('<script>')
    expect(DOC).toContain('<head>')
  })
})

describe('describeRemoved', () => {
  it('says nothing when nothing was found', () => {
    expect(describeRemoved([])).toBeNull()
  })

  it('explains that the PDF was never at risk', () => {
    const msg = describeRemoved(['<script>'])!
    expect(msg).toContain('<script>')
    expect(msg).toContain('never reaches the PDF')
  })

  it('distinguishes stripped from merely detected', () => {
    expect(describeRemoved(['<script>'], true)).toContain('Removed')
    expect(describeRemoved(['<script>'], false)).toContain('contains')
  })
})
