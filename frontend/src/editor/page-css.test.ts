import { describe, expect, it } from 'vitest'
import { laterOverrides, readPageSetup, writePageSetup } from './page-css'

const SIMPLE = '<style>\n  @page { size: A4; margin: 20mm 15mm; }\n  body { font-size: 11pt; }\n</style>\n<h1>x</h1>'

/** A document like the report example: blocks add @page rules of their own to
 * reserve the strip of margin their running element sits in. */
const LAYERED =
  '<style>@page { size: A4; margin: 26mm 18mm; background: #f5f7fb; }</style>\n' +
  '<style>@page { margin-top: 24mm; @top-center { content: element(lf-header); } }</style>\n' +
  '<div style="position: running(lf-header)">head</div>\n'

describe('reading what the page is', () => {
  it('reads size, orientation and the margin shorthand', () => {
    const setup = readPageSetup(SIMPLE)
    expect(setup.size).toBe('A4')
    expect(setup.landscape).toBe(false)
    expect(setup.margin).toEqual({ top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' })
  })

  it('reads landscape and the page background', () => {
    const setup = readPageSetup('<style>@page { size: A5 landscape; background: #eee }</style>')
    expect([setup.size, setup.landscape, setup.background]).toEqual(['A5', true, '#eee'])
  })

  it('takes later rules in cascade order, as a browser would', () => {
    // The header block's rule wins for the top margin, exactly as it does in
    // print — a panel that showed 26mm here would be lying about the page.
    expect(readPageSetup(LAYERED).margin).toEqual({
      top: '24mm',
      right: '18mm',
      bottom: '26mm',
      left: '18mm',
    })
  })

  it('never reads a declaration out of a margin box', () => {
    const css = '<style>@page { size: A4; @top-center { margin: 99mm; content: "x" } }</style>'
    expect(readPageSetup(css).margin.top).toBe('20mm') // the default, not 99mm
  })

  it('falls back to a sane page for a template that says nothing', () => {
    const setup = readPageSetup('<p>no styles at all</p>')
    expect(setup.size).toBe('')
    expect(setup.margin.top).toBe('20mm')
  })

  it('names the side a later rule takes over, and what it set', () => {
    expect(laterOverrides(LAYERED)).toEqual([{ side: 'top', value: '24mm' }])
    expect(laterOverrides(SIMPLE)).toEqual([])
  })
})

describe('writing it back', () => {
  const setup = {
    size: 'A5',
    landscape: true,
    margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
    background: null,
  }

  it('replaces the declarations it owns and keeps the rest of the rule', () => {
    const out = writePageSetup(SIMPLE, setup)
    expect(readPageSetup(out).size).toBe('A5')
    expect(readPageSetup(out).landscape).toBe(true)
    expect(readPageSetup(out).margin.left).toBe('12mm')
    // Everything that was not its business is untouched.
    expect(out).toContain('body { font-size: 11pt; }')
    expect(out).toContain('<h1>x</h1>')
  })

  it('writes one value when all four margins agree', () => {
    const out = writePageSetup(SIMPLE, {
      ...setup,
      margin: { top: '9mm', right: '9mm', bottom: '9mm', left: '9mm' },
    })
    expect(out).toMatch(/margin:\s*9mm;/)
  })

  it('keeps the margin boxes a rule carries', () => {
    const withBox =
      '<style>@page { size: A4; margin: 20mm; @bottom-center { content: counter(page) } }</style>'
    const out = writePageSetup(withBox, setup)
    expect(out).toContain('@bottom-center')
    expect(out).toContain('counter(page)')
    expect(readPageSetup(out).size).toBe('A5')
  })

  it('leaves later rules alone, so a header keeps the space it reserved', () => {
    const out = writePageSetup(LAYERED, setup)
    expect(out).toContain('margin-top: 24mm')
    expect(out).toContain('element(lf-header)')
  })

  it('adds a rule to a stylesheet that has none', () => {
    const out = writePageSetup('<style>body { color: #000 }</style><p>x</p>', setup)
    expect(readPageSetup(out).size).toBe('A5')
    expect(out).toContain('body { color: #000 }')
  })

  it('adds a stylesheet to a template that has none', () => {
    const out = writePageSetup('<p>bare</p>', setup)
    expect(readPageSetup(out).size).toBe('A5')
    expect(out).toContain('<p>bare</p>')
  })

  it('puts the stylesheet in the head when there is one', () => {
    const out = writePageSetup('<html><head><title>t</title></head><body><p>x</p></body></html>', setup)
    expect(out.indexOf('<style>')).toBeLessThan(out.indexOf('</head>'))
    expect(readPageSetup(out).size).toBe('A5')
  })

  it('round-trips: what is written is what is read', () => {
    const full = { ...setup, background: '#fafafa' }
    expect(readPageSetup(writePageSetup(SIMPLE, full))).toEqual(full)
  })

  it('does not grow the stylesheet each time it is written', () => {
    const once = writePageSetup(SIMPLE, setup)
    const twice = writePageSetup(once, setup)
    expect(twice).toBe(once)
  })
})
