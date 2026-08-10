// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { allInline, caretRangeIn, clampOutOfAtomic, isInline } from './range-ops'

function fixture(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.replaceChildren(host)
  return host
}

/** A range over the text of `selector`, from character `from` to `to`. */
function overText(host: HTMLElement, selector: string, from: number, to: number): Range {
  const node = host.querySelector(selector)!.firstChild!
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  return range
}

const CHIP = '<span data-jinja-expr="customer">{{ customer }}</span>'

describe('keeping ranges out of atomic chips', () => {
  it('pulls an end that entered a chip past the whole chip', () => {
    // "Bill to |{{ customer }}| on" with the end one character inside the chip:
    // wrapping that range used to split the span, and the export reads the
    // attribute of each half — one field becomes two.
    const host = fixture(`<p>Bill to ${CHIP} on</p>`)
    const chip = host.querySelector('[data-jinja-expr]')!
    const range = document.createRange()
    range.setStart(host.querySelector('p')!.firstChild!, 0)
    range.setEnd(chip.firstChild!, 3)

    clampOutOfAtomic(range)

    expect(range.endContainer).toBe(chip.parentNode)
    expect(range.toString()).toBe('Bill to {{ customer }}')
  })

  it('leaves a chip alone when the end only touched its front edge', () => {
    const host = fixture(`<p>Bill to ${CHIP} on</p>`)
    const chip = host.querySelector('[data-jinja-expr]')!
    const range = document.createRange()
    range.setStart(host.querySelector('p')!.firstChild!, 0)
    range.setEnd(chip, 0)

    clampOutOfAtomic(range)

    expect(range.toString()).toBe('Bill to ')
    expect(host.querySelectorAll('[data-jinja-expr]')).toHaveLength(1)
  })

  it('pulls a start that began inside a chip out to its front', () => {
    const host = fixture(`<p>${CHIP} and more</p>`)
    const chip = host.querySelector('[data-jinja-expr]')!
    const range = document.createRange()
    range.setStart(chip.firstChild!, 4)
    range.setEnd(host.querySelector('p')!.lastChild!, 4)

    clampOutOfAtomic(range)

    expect(range.toString()).toBe('{{ customer }} and')
  })

  it('turns a range drawn inside one chip into exactly that chip', () => {
    // Part of an atomic thing is not something anyone can act on. The whole of
    // it is — and wrapping a whole chip in <b> is a real thing to want.
    const host = fixture(`<p>${CHIP}</p>`)
    const chip = host.querySelector('[data-jinja-expr]')!
    const range = document.createRange()
    range.setStart(chip.firstChild!, 3)
    range.setEnd(chip.firstChild!, 6)

    clampOutOfAtomic(range)

    expect(range.collapsed).toBe(false)
    expect(range.toString()).toBe('{{ customer }}')
    // …and it is a range that can be wrapped without splitting anything.
    range.surroundContents(document.createElement('b'))
    expect(host.querySelectorAll('[data-jinja-expr]')).toHaveLength(1)
  })

  it('does the same for a locked raw chip', () => {
    const host = fixture('<p>a<span data-jinja-raw="macro">{% macro %}</span>b</p>')
    const raw = host.querySelector('[data-jinja-raw]')!
    const range = document.createRange()
    range.setStart(host.querySelector('p')!.firstChild!, 0)
    range.setEnd(raw.firstChild!, 4)

    clampOutOfAtomic(range)

    expect(range.endContainer).toBe(raw.parentNode)
  })

  it('leaves an ordinary range untouched', () => {
    const host = fixture('<p>plain sentence here</p>')
    const range = overText(host, 'p', 6, 14)
    clampOutOfAtomic(range)
    expect(range.toString()).toBe('sentence')
  })
})

describe('what belongs in a line of text', () => {
  it('counts text, spans, images and the usual inline tags', () => {
    const host = fixture(`<p>t</p>${CHIP}<img src="x"><b>b</b><table><tr><td>c</td></tr></table>`)
    const [p, chip, img, b, table] = Array.from(host.childNodes)
    expect([chip, img, b].every(isInline)).toBe(true)
    expect(isInline(p)).toBe(false)
    expect(isInline(table)).toBe(false)
    expect(isInline(document.createTextNode('x'))).toBe(true)
  })

  it('needs every node to be inline, and at least one', () => {
    const host = fixture(`${CHIP}<p>block</p>`)
    const [chip, block] = Array.from(host.childNodes)
    expect(allInline([chip])).toBe(true)
    expect(allInline([chip, block])).toBe(false)
    expect(allInline([])).toBe(false)
  })
})

describe('finding the caret', () => {
  it('reports a range inside the body and ignores one outside it', () => {
    const host = fixture('<p>inside</p>')
    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.appendChild(outside)

    const selection = document.getSelection()!
    const inRange = document.createRange()
    inRange.setStart(host.querySelector('p')!.firstChild!, 2)
    inRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(inRange)
    expect(caretRangeIn(host)?.startOffset).toBe(2)

    const outRange = document.createRange()
    outRange.setStart(outside.firstChild!, 1)
    outRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(outRange)
    expect(caretRangeIn(host)).toBeNull()
  })
})
