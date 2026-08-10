import { describe, expect, it } from 'vitest'
import { rank, triggerAt } from './typeahead'

const at = (text: string) => triggerAt(text, text.length)

describe('when two braces mean a field', () => {
  it('fires on the braces themselves and on a name being typed after them', () => {
    expect(at('Total: {{')).toMatchObject({ query: '' })
    expect(at('Total: {{ tot')).toMatchObject({ query: 'tot' })
    expect(at('Total: {{cust')).toMatchObject({ query: 'cust' })
    expect(at('{{ item.pri')).toMatchObject({ query: 'item.pri' })
  })

  it('reports where the braces are, so the typing can be replaced by a chip', () => {
    expect(at('Счёт № {{ num')).toMatchObject({ start: 7, end: 13 })
  })

  it('lets go once it stops looking like a name', () => {
    expect(at('{{ 1 + 2')).toBeNull() // prose, or arithmetic for Code mode
    expect(at('{{ name }}')).toBeNull() // already closed
    expect(at('{{ two words')).toBeNull()
    expect(at('{{\nnext line')).toBeNull()
    expect(at(`{{ ${'x'.repeat(60)}`)).toBeNull()
  })

  it('is not fooled by braces earlier in the line', () => {
    expect(at('{{ done }} and then plain text')).toBeNull()
    expect(at('{{ done }} then {{ ne')).toMatchObject({ query: 'ne' })
  })

  it('only looks behind the caret', () => {
    // Caret before the braces: nothing has been typed there yet.
    expect(triggerAt('a {{ name', 1)).toBeNull()
  })
})

describe('ordering what is offered', () => {
  const rows = [
    { label: 'price_list', expression: 'price_list' },
    { label: 'items[].price', expression: 'item.price' },
    { label: 'customer.name', expression: 'customer.name' },
    { label: 'group', expression: null },
  ]

  it('puts a whole-path match first, then a match on the last segment', () => {
    expect(rank(rows, 'pri').map((r) => r.expression)).toEqual(['price_list', 'item.price'])
  })

  it('finds a field by its last segment alone', () => {
    expect(rank(rows, 'name').map((r) => r.expression)).toEqual(['customer.name'])
  })

  it('offers everything writable when nothing has been typed', () => {
    expect(rank(rows, '')).toHaveLength(3)
  })

  it('never offers a row that cannot be written here', () => {
    expect(rank(rows, '').some((r) => r.expression === null)).toBe(false)
  })

  it('keeps the list short enough to read', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      label: `f${i}`,
      expression: `f${i}`,
    }))
    expect(rank(many, 'f')).toHaveLength(8)
  })
})
