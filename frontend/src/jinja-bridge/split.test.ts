import { describe, expect, it } from 'vitest'
import { joinFromVisual, splitForVisual, unwrapBody } from './split'

describe('unwrapBody', () => {
  it('strips the GrapesJS wrapper body tag', () => {
    expect(unwrapBody('<body><h1>x</h1><p>y</p></body>')).toBe('<h1>x</h1><p>y</p>')
  })

  it('drops wrapper attributes (page styling lives in the template itself)', () => {
    expect(unwrapBody('<body class="t" id="iv3a"><p>y</p></body>')).toBe('<p>y</p>')
  })

  it('leaves content without a wrapper untouched', () => {
    expect(unwrapBody('<h1>x</h1>')).toBe('<h1>x</h1>')
  })

  it('unwraps only the outer wrapper once', () => {
    expect(unwrapBody('<body><body><p>x</p></body></body>')).toBe('<body><p>x</p></body>')
  })
})

describe('splitForVisual', () => {
  it('peels leading style blocks off a headless template', () => {
    const html = '<style>@page { size: A4; } body { font: 10pt serif; }</style>\n<h1>{{ title }}</h1><p>text</p>'
    const res = splitForVisual(html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.body).toBe('<h1>{{ title }}</h1><p>text</p>')
    expect(res.styles).toContain('@page { size: A4; }')
    expect(joinFromVisual(res.prefix, res.body, res.suffix)).toBe(html)
  })

  it('splits a full document at the body boundaries', () => {
    const html =
      '<!DOCTYPE html>\n<html lang="ru">\n<head><meta charset="UTF-8"><style>h1 { color: red; }</style></head>\n' +
      '<body>\n<h1>{{ title }}</h1>\n</body>\n</html>'
    const res = splitForVisual(html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.body).toBe('\n<h1>{{ title }}</h1>\n')
    expect(res.styles).toBe('h1 { color: red; }')
    expect(joinFromVisual(res.prefix, res.body, res.suffix)).toBe(html)
  })

  it('multiple leading style blocks are all collected', () => {
    const html = '<style>a { color: blue; }</style><style>b { font-weight: bold; }</style><div>x</div>'
    const res = splitForVisual(html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.styles).toContain('a { color: blue; }')
    expect(res.styles).toContain('b { font-weight: bold; }')
    expect(res.body).toBe('<div>x</div>')
  })

  it('hoists a body style block to the top instead of going code-only', () => {
    // Furniture (header/footer/page-numbers) lives in body <style>; it becomes
    // read-only canvas CSS, and only page-level CSS is relocated.
    const res = splitForVisual('<div>x</div><style>late { }</style><div>y</div>')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.styles).toContain('late { }')
    expect(res.body).toBe('<div>x</div><div>y</div>') // no <style> left in the body
    // Reassembly still yields a valid document (style moved to the front).
    expect(joinFromVisual(res.prefix, res.body, res.suffix)).toBe(
      '<style>late { }</style><div>x</div><div>y</div>',
    )
  })

  it('supports a body <style> in a full document (round-trip byte-exact when already at the top)', () => {
    const html = '<html><body><style>x { }</style><p>t</p></body></html>'
    const res = splitForVisual(html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.styles).toContain('x { }')
    expect(res.body).toBe('<p>t</p>')
    expect(joinFromVisual(res.prefix, res.body, res.suffix)).toBe(html)
  })

  it('handles a template with no styles at all', () => {
    const html = '<h1>{{ t }}</h1>'
    const res = splitForVisual(html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.prefix).toBe('')
    expect(res.body).toBe(html)
    expect(res.styles).toBe('')
  })
})
