// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fieldRows, parseLoop, scopesAt } from './fields'

const DATA = JSON.stringify({
  number: 'INV-1',
  total: 1200,
  customer: { name: 'Globex', tax_id: '123' },
  items: [
    { name: 'Widget', price: 10 },
    { name: 'Gadget', price: 20, note: 'x' },
  ],
  tags: ['a', 'b'],
})

const find = (rows: ReturnType<typeof fieldRows>, label: string) =>
  rows.find((r) => r.label === label)

describe('what the panel offers', () => {
  it('offers the test data as fields, which is where a first field comes from', () => {
    // The template is empty: before this, the panel said "none detected" and
    // there was no way to put a field on the page at all.
    const rows = fieldRows(DATA, [], [])
    expect(find(rows, 'number')?.expression).toBe('number')
    expect(find(rows, 'total')?.sample).toBe('1200')
  })

  it('walks into nested objects and writes the dotted path', () => {
    const rows = fieldRows(DATA, [], [])
    expect(find(rows, 'customer')?.kind).toBe('group')
    expect(find(rows, 'customer.name')).toMatchObject({ expression: 'customer.name', depth: 1 })
  })

  it('keeps array fields out of reach until a loop is walking that array', () => {
    const outside = fieldRows(DATA, [], [])
    expect(find(outside, 'items[].price')).toMatchObject({ expression: null, needs: 'items' })

    const inside = fieldRows(DATA, [], [{ item: 'row', array: 'items' }])
    // …and inside, written with the name that loop gave it.
    expect(find(inside, 'items[].price')?.expression).toBe('row.price')
  })

  it('takes the union of the item keys, so a field only some items carry is offered', () => {
    const rows = fieldRows(DATA, [], [{ item: 'item', array: 'items' }])
    expect(find(rows, 'items[].note')?.expression).toBe('item.note')
  })

  it('offers the loop variable itself for an array of plain values', () => {
    const rows = fieldRows(DATA, [], [{ item: 'tag', array: 'tags' }])
    expect(find(rows, 'tags[] item')?.expression).toBe('tag')
  })

  it('adds placeholders the sample data has never heard of', () => {
    const rows = fieldRows(DATA, ['number', 'signed_by'], [])
    expect(find(rows, 'signed_by')).toMatchObject({ source: 'template', expression: 'signed_by' })
    expect(find(rows, 'number')?.source).toBe('both')
    expect(find(rows, 'total')?.source).toBe('data')
  })

  it('marks an array the template already walks', () => {
    expect(find(fieldRows(DATA, ['items'], []), 'items[]')?.source).toBe('both')
  })

  it('lists a key no template can name, rather than dropping it silently', () => {
    // `{{ total sum }}` is not a thing; naming that key needs subscript syntax,
    // which is Code mode's business. Showing it greyed beats showing nothing
    // and letting somebody hunt for the field they can see in their JSON.
    const rows = fieldRows(JSON.stringify({ 'total sum': 1, ok: 2 }), [], [])
    expect(find(rows, 'total sum')?.expression).toBeNull()
    expect(find(rows, 'ok')?.expression).toBe('ok')
  })

  it('survives test data that is not an object, or not JSON at all', () => {
    expect(fieldRows('', ['a'], [])).toHaveLength(1)
    expect(fieldRows('[1,2]', [], [])).toHaveLength(0)
    expect(fieldRows('{ broken', ['a'], [])[0].label).toBe('a')
  })

  it('stops descending before a deeply nested payload becomes a wall', () => {
    const deep = JSON.stringify({ a: { b: { c: { d: { e: 1 } } } } })
    expect(fieldRows(deep, [], []).some((r) => r.label.includes('.c.d'))).toBe(false)
  })
})

describe('which loops are in force', () => {
  it('reads them from the marker attributes, outermost first', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<table><tr data-jinja-for="row in metrics"><td>' +
      '<span data-jinja-for="tag in row.tags" id="inner">x</span></td></tr></table>'
    expect(scopesAt(root.querySelector('#inner'), root)).toEqual([
      { item: 'row', array: 'metrics' },
      { item: 'tag', array: 'row.tags' },
    ])
  })

  it('is empty outside any loop', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p id="p">plain</p>'
    expect(scopesAt(root.querySelector('#p'), root)).toEqual([])
  })

  it('leaves anything cleverer than two names to Code mode', () => {
    expect(parseLoop('item in items')).toEqual({ item: 'item', array: 'items' })
    expect(parseLoop('a, b in pairs')).toBeNull()
    expect(parseLoop('x in items|sort')).toBeNull()
  })
})
