import { describe, expect, it } from 'vitest'
import { parseHints } from './hints'

describe('parseHints', () => {
  it('separates arrays from scalar fields and unions item keys', () => {
    const h = parseHints(
      JSON.stringify({
        number: '12345',
        customer: 'ACME',
        items: [
          { name: 'Widget', price: '10' },
          { name: 'Gadget', price: '20', sku: 'X1' },
        ],
      }),
    )
    expect(h.fields.sort()).toEqual(['customer', 'number'])
    expect(h.arrays).toHaveLength(1)
    expect(h.arrays[0].name).toBe('items')
    expect(h.arrays[0].itemFields.sort()).toEqual(['name', 'price', 'sku'])
  })

  it('reports a scalar array with no item fields', () => {
    const h = parseHints(JSON.stringify({ digits: ['1', '2', '3'] }))
    expect(h.arrays).toEqual([{ name: 'digits', itemFields: [] }])
    expect(h.fields).toEqual([])
  })

  it('is tolerant: invalid or non-object JSON yields empty hints', () => {
    expect(parseHints('not json')).toEqual({ fields: [], arrays: [] })
    expect(parseHints('[1,2,3]')).toEqual({ fields: [], arrays: [] })
    expect(parseHints('42')).toEqual({ fields: [], arrays: [] })
    expect(parseHints('{}')).toEqual({ fields: [], arrays: [] })
  })
})
