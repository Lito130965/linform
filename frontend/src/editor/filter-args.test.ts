import { describe, expect, it } from 'vitest'
import { getFilterArg, setFilterArg } from './filter-args'

describe('setFilterArg', () => {
  it('adds an argument to a bare filter', () => {
    expect(setFilterArg('{{ order_id | qr }}', 'qr', 'dark', '#c00')).toBe(
      "{{ order_id | qr(dark='#c00') }}",
    )
  })

  it('appends to existing arguments without disturbing them', () => {
    const src = "{{ tracking | barcode('code128', text=True) }}"
    expect(setFilterArg(src, 'barcode', 'foreground', '#000')).toBe(
      "{{ tracking | barcode('code128', text=True, foreground='#000') }}",
    )
  })

  it('updates an argument already present', () => {
    const src = "{{ order_id | qr(dark='#000', light='#fff') }}"
    expect(setFilterArg(src, 'qr', 'dark', '#ff0000')).toBe(
      "{{ order_id | qr(dark='#ff0000', light='#fff') }}",
    )
  })

  it('leaves the source alone when the filter is absent', () => {
    expect(setFilterArg('{{ x }}', 'qr', 'dark', '#000')).toBe('{{ x }}')
  })
})

describe('getFilterArg', () => {
  it('reads a present argument and null otherwise', () => {
    const src = "{{ order_id | qr(dark='#abcdef') }}"
    expect(getFilterArg(src, 'qr', 'dark')).toBe('#abcdef')
    expect(getFilterArg(src, 'qr', 'light')).toBeNull()
    expect(getFilterArg('{{ order_id | qr }}', 'qr', 'dark')).toBeNull()
  })
})
