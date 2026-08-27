import { describe, expect, it } from 'vitest'
import { describeOp, extractOps, withoutOpsBlock, type Op } from './ops'

const block = (json: string) => '```linform-ops\n' + json + '\n```'

describe('finding the operations in a reply', () => {
  it('says nothing when the reply carries none', () => {
    // Not an empty edit: a plain answer and an answer that asked for nothing
    // are different things, and only one of them should offer an Apply button.
    expect(extractOps('Your template already has a footer.')).toBeNull()
    expect(extractOps('```html\n<p>hi</p>\n```')).toBeNull()
  })

  it('takes a bare array and an object with an ops key alike', () => {
    const ops = [{ op: 'furniture', edge: 'bottom', on: true }]
    expect(extractOps(block(JSON.stringify(ops)))?.ops).toEqual(ops)
    expect(extractOps(block(JSON.stringify({ ops })))?.ops).toEqual(ops)
  })

  it('reports the block itself when the JSON is broken', () => {
    const found = extractOps(block('{ not json'))
    expect(found?.ops).toEqual([])
    expect(found?.rejected).toHaveLength(1)
  })
})

describe('refusing what this editor does not have', () => {
  it('names an operation it does not know rather than ignoring it', () => {
    const found = extractOps(block('[{"op": "set-font", "family": "Arial"}]'))
    expect(found?.ops).toEqual([])
    expect(found?.rejected[0]).toEqual({
      what: 'set-font',
      why: 'not an operation this editor has',
    })
  })

  it('keeps the operations it does know from the same block', () => {
    const found = extractOps(
      block('[{"op": "set-font"}, {"op": "block", "id": "table"}]'),
    )
    expect(found?.ops).toEqual([{ op: 'block', id: 'table' }])
    expect(found?.rejected).toHaveLength(1)
  })

  it('checks a block or preset actually exists', () => {
    expect(extractOps(block('[{"op": "block", "id": "carousel"}]'))?.rejected[0].what).toBe(
      'block carousel',
    )
    expect(extractOps(block('[{"op": "preset", "id": "invoice-total"}]'))?.rejected[0].what).toBe(
      'preset invoice-total',
    )
  })

  it('checks a preset parameter belongs to that preset', () => {
    const found = extractOps(
      block('[{"op": "preset", "id": "qr", "params": {"colour": "red"}}]'),
    )
    expect(found?.rejected[0].what).toBe('preset qr parameter colour')
  })

  it('takes only page sizes the editor offers, and lengths a printer understands', () => {
    expect(extractOps(block('[{"op": "page", "size": "A6"}]'))?.rejected[0].why).toContain('A4')
    expect(
      extractOps(block('[{"op": "page", "margin": {"top": "2rem"}}]'))?.rejected[0].why,
    ).toContain('length')
    expect(extractOps(block('[{"op": "page", "margin": {"top": "18mm"}}]'))?.ops).toEqual([
      { op: 'page', margin: { top: '18mm' } },
    ])
  })

  it('takes a field path but not a Jinja statement', () => {
    expect(extractOps(block('[{"op": "field", "expression": "customer.name"}]'))?.ops).toHaveLength(1)
    expect(extractOps(block('[{"op": "field", "expression": "total | round(2)"}]'))?.ops).toHaveLength(1)
    expect(
      extractOps(block('[{"op": "field", "expression": "{% for x in y %}"}]'))?.rejected,
    ).toHaveLength(1)
  })

  it('will not accept a page operation that changes nothing', () => {
    expect(extractOps(block('[{"op": "page"}]'))?.rejected[0].why).toBe('nothing to change')
  })
})

describe('saying what will happen before it happens', () => {
  const lines = (ops: Op[]) => ops.map(describeOp)

  it('describes each operation in a sentence', () => {
    expect(
      lines([
        { op: 'page', size: 'A5', landscape: true, margin: { top: '15mm' } },
        { op: 'furniture', edge: 'bottom', on: true },
        { op: 'block', id: 'table' },
        { op: 'preset', id: 'page-numbers', params: { pattern: 'Page {page}' } },
        { op: 'field', expression: 'customer.name' },
      ]),
    ).toEqual([
      'Page: A5 landscape; margins top 15mm',
      'Add the footer',
      'Insert Table',
      'Insert Page number (pattern: Page {page})',
      'Insert the field {{ customer.name }}',
    ])
  })
})

describe('the prose around the block', () => {
  it('leaves the sentence and drops the JSON', () => {
    const reply = 'Turned the footer on and put the page number in it.\n\n' + block('[]')
    expect(withoutOpsBlock(reply)).toBe('Turned the footer on and put the page number in it.')
  })
})
