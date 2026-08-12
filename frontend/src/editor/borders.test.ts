// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  NO_BORDER,
  applyBorders,
  borderToCss,
  parseBorder,
  readBorders,
  sameOnEverySide,
  type Border,
  type Side,
} from './borders'

const four = (border: Border): Record<Side, Border> => ({
  top: border,
  right: border,
  bottom: border,
  left: border,
})

describe('reading a border somebody wrote', () => {
  it('takes the three parts in any order', () => {
    expect(parseBorder('1px solid #333')).toEqual({
      width: '1px',
      style: 'solid',
      colour: '#333',
    })
    expect(parseBorder('#c00 dashed 2mm')).toEqual({
      width: '2mm',
      style: 'dashed',
      colour: '#c00',
    })
  })

  it('reads none as none, whatever else is written beside it', () => {
    expect(parseBorder('none').style).toBe('none')
    expect(parseBorder('1px none #000').style).toBe('none')
  })

  it('falls back rather than throwing at something it does not know', () => {
    expect(parseBorder('')).toEqual(NO_BORDER)
    expect(parseBorder('thin ridge orange').width).toBe('thin')
  })
})

describe('writing the four sides', () => {
  it('uses the shorthand when every side agrees', () => {
    // Asserted on what the element ends up with, not on the exact string: the
    // browser normalises a colour on the way in, and the spelling is its
    // business rather than this module's.
    const el = document.createElement('div')
    applyBorders(el, four({ width: '1px', style: 'solid', colour: '#000000' }))
    expect(el.style.borderTopStyle).toBe('solid')
    expect(el.getAttribute('style')).toMatch(/^border: 1px solid /)
    expect(el.getAttribute('style')).not.toContain('border-top')
  })

  it('writes one side at a time when they differ', () => {
    // The bare side is written `border-top-style: none`, which jsdom's CSSOM
    // does not implement at all — not the property, not the serialisation. The
    // browser test carries that half of the claim (e2e/tests/element.spec.ts);
    // what can be checked here is that the shorthand is not used when the four
    // sides disagree, which is the decision this function makes.
    const el = document.createElement('div')
    applyBorders(el, {
      ...four({ width: '1px', style: 'none', colour: '#000000' }),
      bottom: { width: '2px', style: 'solid', colour: '#333333' },
    })
    const style = el.getAttribute('style')!
    expect(style).toMatch(/border-bottom: 2px solid /)
    expect(style).not.toMatch(/(^|;)\s*border:/)
  })

  it('clears the sides it wrote last time, so an old edge cannot survive', () => {
    // A longhand written after a shorthand wins, whatever the order of the two
    // in the style attribute — the reason for clearing rather than overwriting.
    const el = document.createElement('div')
    applyBorders(el, {
      ...four({ width: '1px', style: 'none', colour: '#000000' }),
      top: { width: '3px', style: 'double', colour: '#111111' },
    })
    applyBorders(el, four({ width: '1px', style: 'solid', colour: '#000000' }))
    expect(el.getAttribute('style')).toMatch(/^border: 1px solid /)
    expect(el.getAttribute('style')).not.toContain('double')
  })

  it('takes the border it wrote away again, rather than leaving the last one', () => {
    const el = document.createElement('div')
    applyBorders(el, four({ width: '1px', style: 'solid', colour: '#000000' }))
    applyBorders(el, four({ width: '1px', style: 'none', colour: '#000000' }))
    // The declaration that removes a border from the stylesheet as well —
    // `border-style: none` — is one jsdom's CSSOM does not implement, so that
    // half is checked in the browser. What matters here: the previous border
    // is not still standing.
    expect(el.getAttribute('style') ?? '').not.toMatch(/border: 1px solid/)
  })
})

describe('reading what the element has now', () => {
  it('reports each side from the resolved style', () => {
    const el = document.createElement('div')
    el.style.borderBottom = '2px dashed rgb(51, 51, 51)'
    document.body.append(el)
    const borders = readBorders(el, window)
    expect(borders.bottom.style).toBe('dashed')
    expect(sameOnEverySide(borders)).toBe(false)
  })

  it('says when all four are the same', () => {
    const el = document.createElement('div')
    el.style.border = '1px solid rgb(0, 0, 0)'
    document.body.append(el)
    expect(sameOnEverySide(readBorders(el, window))).toBe(true)
  })
})

describe('borderToCss', () => {
  it('collapses a styleless border to the one word that removes it', () => {
    expect(borderToCss({ width: '4px', style: 'none', colour: '#fff' })).toBe('none')
  })
})
