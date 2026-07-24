import { describe, expect, it } from 'vitest'
import { parse, toCss, toHex } from './color'

describe('color parse', () => {
  it('reads rgba, rgb, and hex in 3/6/8 digits', () => {
    expect(parse('rgba(255, 0, 0, 0.5)')).toEqual({ hex: '#ff0000', opacity: 50 })
    expect(parse('rgb(0, 128, 255)')).toEqual({ hex: '#0080ff', opacity: 100 })
    expect(parse('#0a0b0c')).toEqual({ hex: '#0a0b0c', opacity: 100 })
    expect(parse('#abc')).toEqual({ hex: '#aabbcc', opacity: 100 })
    expect(parse('#ff000080')).toEqual({ hex: '#ff0000', opacity: 50 })
  })

  it('falls back to opaque black on empty or junk', () => {
    expect(parse('')).toEqual({ hex: '#000000', opacity: 100 })
    expect(parse('inherit')).toEqual({ hex: '#000000', opacity: 100 })
  })
})

describe('color serialise', () => {
  it('CSS is always rgba', () => {
    expect(toCss({ hex: '#ff0000', opacity: 50 })).toBe('rgba(255, 0, 0, 0.5)')
    expect(toCss({ hex: '#000000', opacity: 100 })).toBe('rgba(0, 0, 0, 1)')
  })

  it('filter hex is 6-digit at full opacity, 8-digit otherwise', () => {
    expect(toHex({ hex: '#ff0000', opacity: 100 })).toBe('#ff0000')
    expect(toHex({ hex: '#ff0000', opacity: 50 })).toBe('#ff000080')
    expect(toHex({ hex: '#ffffff', opacity: 0 })).toBe('#ffffff00')
  })

  it('round-trips a parsed colour', () => {
    const c = parse('rgba(18, 52, 86, 0.25)')
    expect(parse(toCss(c))).toEqual(c)
    expect(parse(toHex(c))).toEqual(c)
  })
})
