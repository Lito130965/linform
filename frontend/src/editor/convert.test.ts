// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { restore } from '../jinja-bridge'
import {
  existingValue,
  isConditional,
  isRepeating,
  makeRepeating,
  wrapConditional,
} from './convert'

function bodyOf(html: string): HTMLElement {
  const el = document.createElement('body')
  el.innerHTML = html
  return el
}

describe('convert-existing', () => {
  it('make repeating marks the row so it exports as a for-loop', () => {
    const b = bodyOf('<table><tbody><tr><td>{{ item.name }}</td></tr></tbody></table>')
    const tr = b.querySelector('tr')!
    makeRepeating(tr, 'item', 'items')
    expect(isRepeating(tr)).toBe(true)
    // Through the bridge, the marker becomes a real {% for %} around the row.
    expect(restore(b.innerHTML)).toContain('{% for item in items %}<tr>')
    expect(restore(b.innerHTML)).toContain('{% endfor %}')
  })

  it('wrap conditional marks the block so it exports as an if', () => {
    const b = bodyOf('<div>Discount applies</div>')
    const div = b.querySelector('div')!
    wrapConditional(div, 'discount')
    expect(isConditional(div)).toBe(true)
    expect(restore(b.innerHTML)).toContain('{% if discount %}<div>')
    expect(restore(b.innerHTML)).toContain('{% endif %}')
  })

  it('existingValue reads a chip expression or a plain placeholder', () => {
    const cell = (inner: string) =>
      bodyOf(`<table><tbody><tr><td>${inner}</td></tr></tbody></table>`).querySelector('td')!
    expect(existingValue(cell('<span data-jinja-expr="order.no">{{ order.no }}</span>'))).toBe(
      'order.no',
    )
    expect(existingValue(cell('{{ iin }}'))).toBe('iin')
    expect(existingValue(cell('static'))).toBe('')
  })
})
