import { describe, expect, it } from 'vitest'
import { hasFurniture, hasRunningElement, setFurniture } from './furniture-setup'

const PLAIN = '<style>\n  @page { size: A4; margin: 20mm; }\n</style>\n<h1>Report</h1>\n'

describe('switching a header on', () => {
  it('writes both halves, because either alone does nothing', () => {
    // A margin box with no element prints empty; an element no box pulls prints
    // nowhere. Nobody should have to know that to put a name at the top.
    const out = setFurniture(PLAIN, 'top', true)
    expect(hasFurniture(out, 'top')).toBe(true)
    expect(hasRunningElement(out, 'top')).toBe(true)
    expect(out).toContain('@top-center')
    expect(out).toContain('element(lf-header)')
  })

  it('leaves the rest of the page rule alone', () => {
    const out = setFurniture(PLAIN, 'top', true)
    expect(out).toMatch(/size:\s*A4/)
    expect(out).toMatch(/margin:\s*20mm/)
    expect(out).toContain('<h1>Report</h1>')
  })

  it('puts the header at the top of the body and the footer at the end', () => {
    const out = setFurniture(setFurniture(PLAIN, 'top', true), 'bottom', true)
    expect(out.indexOf('lf-header')).toBeLessThan(out.indexOf('<h1>'))
    expect(out.lastIndexOf('lf-footer')).toBeGreaterThan(out.indexOf('<h1>'))
  })

  it('does not add a second one when it is already on', () => {
    const once = setFurniture(PLAIN, 'top', true)
    const twice = setFurniture(once, 'top', true)
    expect(twice.match(/@top-center/g)).toHaveLength(1)
    expect(twice.match(/running\(lf-header\)/g)).toHaveLength(1)
  })

  it('starts a page rule when the template has none', () => {
    const out = setFurniture('<style>body { font-size: 11pt }</style><p>x</p>', 'top', true)
    expect(hasFurniture(out, 'top')).toBe(true)
    expect(out).toContain('body { font-size: 11pt }')
  })
})

describe('switching it off', () => {
  it('takes both halves away', () => {
    const on = setFurniture(PLAIN, 'top', true)
    const off = setFurniture(on, 'top', false)
    expect(hasFurniture(off, 'top')).toBe(false)
    expect(hasRunningElement(off, 'top')).toBe(false)
    expect(off).toContain('<h1>Report</h1>')
  })

  it('takes the whole element, including what was put inside it', () => {
    // A lazy match to the first </div> would cut a header holding a
    // three-column block in half and leave the rest standing on the page.
    const rich =
      '<style>@page { @top-center { content: element(lf-header) } }</style>\n' +
      '<div style="position: running(lf-header)"><table><tr><td>' +
      '<div>left</div></td><td>right</td></tr></table></div>\n<h1>Report</h1>\n'
    const off = setFurniture(rich, 'top', false)
    expect(off).not.toContain('left')
    expect(off).not.toContain('</table>')
    expect(off).toContain('<h1>Report</h1>')
  })

  it('clears the box out of a rule a block added, not only the first one', () => {
    const layered =
      '<style>@page { size: A4; margin: 20mm }</style>\n' +
      '<style>@page { margin-top: 22mm; @top-center { content: element(lf-header) } }</style>\n' +
      '<div style="position: running(lf-header)">Head</div>\n<p>x</p>'
    const off = setFurniture(layered, 'top', false)
    expect(hasFurniture(off, 'top')).toBe(false)
    // The margin that rule also set is not this switch's business.
    expect(off).toContain('margin-top: 22mm')
  })

  it('leaves the other edge alone', () => {
    const both = setFurniture(setFurniture(PLAIN, 'top', true), 'bottom', true)
    const off = setFurniture(both, 'top', false)
    expect(hasFurniture(off, 'bottom')).toBe(true)
    expect(hasRunningElement(off, 'bottom')).toBe(true)
  })

  it('does nothing to a template that never had one', () => {
    expect(setFurniture(PLAIN, 'bottom', false)).toContain('<h1>Report</h1>')
    expect(hasFurniture(setFurniture(PLAIN, 'bottom', false), 'bottom')).toBe(false)
  })
})
